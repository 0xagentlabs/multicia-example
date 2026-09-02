#![no_std]

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    no_allocator, nostd_panic_handler, program_entrypoint,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::{CreateAccount, Transfer};

program_entrypoint!(process_instruction);
no_allocator!();
nostd_panic_handler!();

pub const ID: Address = Address::new_from_array([
    9, 43, 25, 11, 63, 23, 231, 145, 188, 52, 52, 1, 243, 31, 241, 125, 160, 30, 66, 173, 83, 77,
    9, 207, 146, 101, 129, 132, 252, 19, 46, 246,
]);
pub const OPERATION_FEE_LAMPORTS: u64 = 1_000_000;
const COUNTER_LEN: usize = 43;
const CONFIG_LEN: usize = 35;
const VAULT_LEN: usize = 2;
const COUNTER_DISCRIMINATOR: u8 = 1;
const CONFIG_DISCRIMINATOR: u8 = 2;
const VAULT_DISCRIMINATOR: u8 = 3;
const VERSION: u8 = 1;

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    match data {
        [0] => initialize_counter(accounts),
        [1] => update_counter(accounts, 1),
        [2] => update_counter(accounts, -1),
        [3] => set_owner(accounts),
        [4, amount @ ..] if amount.len() == 8 => withdraw(accounts, amount),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// [authority(w,s), counter(w), vault(w), system_program]
fn initialize_counter(accounts: &mut [AccountView]) -> ProgramResult {
    let [authority, counter, vault, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_payer(authority)?;
    require_vault(vault)?;
    require_system_program(system_program)?;
    if !counter.is_data_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let (expected, bump) = counter_pda(authority.address());
    if counter.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    collect_fee(authority, vault)?;
    let bump_seed = [bump];
    let seeds = [
        Seed::from(b"counter"),
        Seed::from(authority.address().as_ref()),
        Seed::from(bump_seed.as_slice()),
    ];
    CreateAccount::with_minimum_balance(authority, counter, COUNTER_LEN as u64, &ID, None)?
        .invoke_signed(&[Signer::from(&seeds)])?;
    let mut out = counter.try_borrow_mut()?;
    out.fill(0);
    out[0] = COUNTER_DISCRIMINATOR;
    out[1] = VERSION;
    out[10..42].copy_from_slice(authority.address().as_ref());
    out[42] = bump;
    Ok(())
}

// [authority(w,s), counter(w), vault(w), system_program]
fn update_counter(accounts: &mut [AccountView], delta: i64) -> ProgramResult {
    let [authority, counter, vault, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_payer(authority)?;
    require_vault(vault)?;
    require_system_program(system_program)?;
    let current = {
        require_program_account(counter, COUNTER_DISCRIMINATOR, COUNTER_LEN)?;
        let state = counter.try_borrow()?;
        if &state[10..42] != authority.address().as_ref() {
            return Err(CounterError::Unauthorized.into());
        }
        i64::from_le_bytes(
            state[2..10]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        )
    };
    let next = current.checked_add(delta).ok_or(CounterError::Overflow)?;
    collect_fee(authority, vault)?;
    counter.try_borrow_mut()?[2..10].copy_from_slice(&next.to_le_bytes());
    Ok(())
}

// First successful caller becomes the immutable owner.
// [candidate(w,s), config(w), vault(w), system_program]
fn set_owner(accounts: &mut [AccountView]) -> ProgramResult {
    let [candidate, config, vault, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_payer(candidate)?;
    require_system_program(system_program)?;
    if !config.is_data_empty() || !vault.is_data_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let (expected_config, config_bump) = config_pda();
    let (expected_vault, vault_bump) = vault_pda();
    if config.address() != &expected_config || vault.address() != &expected_vault {
        return Err(ProgramError::InvalidSeeds);
    }
    let config_bump_seed = [config_bump];
    let config_seeds = [
        Seed::from(b"config"),
        Seed::from(config_bump_seed.as_slice()),
    ];
    CreateAccount::with_minimum_balance(candidate, config, CONFIG_LEN as u64, &ID, None)?
        .invoke_signed(&[Signer::from(&config_seeds)])?;
    let vault_bump_seed = [vault_bump];
    let vault_seeds = [Seed::from(b"vault"), Seed::from(vault_bump_seed.as_slice())];
    CreateAccount::with_minimum_balance(candidate, vault, VAULT_LEN as u64, &ID, None)?
        .invoke_signed(&[Signer::from(&vault_seeds)])?;
    let mut config_data = config.try_borrow_mut()?;
    config_data[0] = CONFIG_DISCRIMINATOR;
    config_data[1] = VERSION;
    config_data[2..34].copy_from_slice(candidate.address().as_ref());
    config_data[34] = config_bump;
    let mut vault_data = vault.try_borrow_mut()?;
    vault_data[0] = VAULT_DISCRIMINATOR;
    vault_data[1] = vault_bump;
    Ok(())
}

// amount=0 withdraws all fees while preserving rent exemption.
// [owner(w,s), config, vault(w), destination(w)]
fn withdraw(accounts: &mut [AccountView], amount_bytes: &[u8]) -> ProgramResult {
    let [owner, config, vault, destination, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_payer(owner)?;
    require_writable(destination)?;
    require_program_account(config, CONFIG_DISCRIMINATOR, CONFIG_LEN)?;
    require_vault(vault)?;
    if config.address() != &config_pda().0 {
        return Err(ProgramError::InvalidSeeds);
    }
    if destination.address() == vault.address() {
        return Err(ProgramError::InvalidAccountData);
    }
    let config_data = config.try_borrow()?;
    if &config_data[2..34] != owner.address().as_ref() {
        return Err(CounterError::Unauthorized.into());
    }
    drop(config_data);
    let reserve = Rent::get()?.try_minimum_balance(VAULT_LEN)?;
    let available = vault
        .lamports()
        .checked_sub(reserve)
        .ok_or(CounterError::InsufficientFunds)?;
    let requested = u64::from_le_bytes(
        amount_bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let amount = if requested == 0 { available } else { requested };
    if amount == 0 || amount > available {
        return Err(CounterError::InsufficientFunds.into());
    }
    vault.set_lamports(
        vault
            .lamports()
            .checked_sub(amount)
            .ok_or(CounterError::Overflow)?,
    );
    destination.set_lamports(
        destination
            .lamports()
            .checked_add(amount)
            .ok_or(CounterError::Overflow)?,
    );
    Ok(())
}

fn collect_fee(authority: &AccountView, vault: &AccountView) -> ProgramResult {
    Transfer {
        from: authority,
        to: vault,
        lamports: OPERATION_FEE_LAMPORTS,
    }
    .invoke()
}
fn counter_pda(authority: &Address) -> (Address, u8) {
    Address::find_program_address(&[b"counter", authority.as_ref()], &ID)
}
fn config_pda() -> (Address, u8) {
    Address::find_program_address(&[b"config"], &ID)
}
fn vault_pda() -> (Address, u8) {
    Address::find_program_address(&[b"vault"], &ID)
}
fn require_vault(account: &AccountView) -> ProgramResult {
    require_program_account(account, VAULT_DISCRIMINATOR, VAULT_LEN)?;
    if account.address() != &vault_pda().0 {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(())
}
fn require_program_account(account: &AccountView, discriminator: u8, len: usize) -> ProgramResult {
    let data = account.try_borrow()?;
    if account.owner() != &ID
        || account.data_len() != len
        || data[0] != discriminator
        || (discriminator != VAULT_DISCRIMINATOR && data[1] != VERSION)
    {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}
fn require_payer(account: &AccountView) -> ProgramResult {
    if !account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    require_writable(account)
}
fn require_writable(account: &AccountView) -> ProgramResult {
    if !account.is_writable() {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}
fn require_system_program(account: &AccountView) -> ProgramResult {
    if account.address() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

#[repr(u32)]
enum CounterError {
    Unauthorized = 0,
    Overflow = 1,
    InsufficientFunds = 2,
}
impl From<CounterError> for ProgramError {
    fn from(value: CounterError) -> Self {
        ProgramError::Custom(value as u32)
    }
}
