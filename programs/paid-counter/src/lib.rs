#![no_std]

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    no_allocator, nostd_panic_handler, program_entrypoint,
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::{CreateAccount, Transfer};

program_entrypoint!(process_instruction);
no_allocator!();
nostd_panic_handler!();

pub const ID: Address = Address::new_from_array([
    254, 202, 203, 102, 130, 130, 231, 201, 42, 82, 254, 218, 49, 30, 227, 175,
    237, 197, 41, 67, 161, 10, 18, 174, 137, 20, 128, 68, 112, 106, 193, 236,
]);
pub const OPERATION_FEE_LAMPORTS: u64 = 1_000_000;
const COUNTER_LEN: usize = 75;
const COUNTER_DISCRIMINATOR: u8 = 1;
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
        [0] => initialize(accounts),
        [1] => update(accounts, 1),
        [2] => update(accounts, -1),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// [authority(w,s), counter(w), beneficiary(w), system_program]
fn initialize(accounts: &mut [AccountView]) -> ProgramResult {
    let [authority, counter, beneficiary, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_payer(authority)?;
    require_writable(beneficiary)?;
    require_system_program(system_program)?;
    if beneficiary.address() == authority.address() {
        return Err(CounterError::InvalidBeneficiary.into());
    }
    if !counter.is_data_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let (expected, bump) = Address::find_program_address(
        &[b"counter", authority.address().as_ref()],
        &ID,
    );
    if counter.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }

    collect_fee(authority, beneficiary)?;
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
    out[42..74].copy_from_slice(beneficiary.address().as_ref());
    out[74] = bump;
    Ok(())
}

// [authority(w,s), counter(w), beneficiary(w), system_program]
fn update(accounts: &mut [AccountView], delta: i64) -> ProgramResult {
    let [authority, counter, beneficiary, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_payer(authority)?;
    require_writable(beneficiary)?;
    require_system_program(system_program)?;
    if counter.owner() != &ID || counter.data_len() != COUNTER_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let current = {
        let state = counter.try_borrow()?;
        if state[0] != COUNTER_DISCRIMINATOR
            || state[1] != VERSION
            || &state[10..42] != authority.address().as_ref()
            || &state[42..74] != beneficiary.address().as_ref()
        {
            return Err(CounterError::Unauthorized.into());
        }
        i64::from_le_bytes(
            state[2..10]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        )
    };
    let next = current.checked_add(delta).ok_or(CounterError::Overflow)?;
    collect_fee(authority, beneficiary)?;
    counter.try_borrow_mut()?[2..10].copy_from_slice(&next.to_le_bytes());
    Ok(())
}

fn collect_fee(authority: &AccountView, beneficiary: &AccountView) -> ProgramResult {
    Transfer {
        from: authority,
        to: beneficiary,
        lamports: OPERATION_FEE_LAMPORTS,
    }
    .invoke()
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
    InvalidBeneficiary = 2,
}

impl From<CounterError> for ProgramError {
    fn from(value: CounterError) -> Self {
        ProgramError::Custom(value as u32)
    }
}
