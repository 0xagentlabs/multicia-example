#![no_std]

use pinocchio::{
    cpi::{Seed, Signer}, error::ProgramError, no_allocator, nostd_panic_handler,
    program_entrypoint, AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::TransferChecked;

program_entrypoint!(process_instruction);
no_allocator!();
nostd_panic_handler!();

pub const ID: Address = Address::new_from_array([
    86, 65, 85, 76, 84, 1, 9, 37, 72, 91, 15, 211, 44, 101, 8, 193,
    17, 64, 201, 87, 39, 222, 14, 111, 92, 10, 198, 71, 25, 166, 4, 218,
]);
const STATE_LEN: usize = 68;
const DISC: u8 = 1;

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if program_id != &ID { return Err(ProgramError::IncorrectProgramId); }
    let (tag, payload) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => initialize(accounts),
        1 => transfer(accounts, payload, false),
        2 => transfer(accounts, payload, true),
        3 => set_agent(accounts, payload),
        4 => set_paused(accounts, payload),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// [payer(w,s), authority(s), agent, state(w), system]
fn initialize(a: &mut [AccountView]) -> ProgramResult {
    let [payer, authority, agent, state, system, ..] = a else { return Err(ProgramError::NotEnoughAccountKeys); };
    signer(payer)?; signer(authority)?; writable(payer)?; writable(state)?;
    if system.address() != &pinocchio_system::ID { return Err(ProgramError::IncorrectProgramId); }
    let (expected, bump) = Address::find_program_address(&[b"vault", authority.address().as_ref()], &ID);
    if state.address() != &expected { return Err(ProgramError::InvalidSeeds); }
    let bs = [bump];
    let seeds = [Seed::from(b"vault"), Seed::from(authority.address().as_ref()), Seed::from(bs.as_slice())];
    CreateAccount::with_minimum_balance(payer, state, STATE_LEN as u64, &ID, None)?.invoke_signed(&[Signer::from(&seeds)])?;
    let mut d = state.try_borrow_mut()?;
    d.fill(0); d[0] = DISC; d[1] = 1;
    d[2..34].copy_from_slice(authority.address().as_ref());
    d[34..66].copy_from_slice(agent.address().as_ref());
    d[66] = bump;
    Ok(())
}

// deposit: [actor(s), state, source(w), mint, vault_token(w), token_program]
// withdraw: [actor(s), state(s PDA), vault_token(w), mint, destination(w), token_program]
// payload: amount[u64 LE], decimals[u8]
fn transfer(a: &mut [AccountView], d: &[u8], withdraw: bool) -> ProgramResult {
    if d.len() != 9 { return Err(ProgramError::InvalidInstructionData); }
    let [actor, state, from, mint, to, token_program, ..] = a else { return Err(ProgramError::NotEnoughAccountKeys); };
    signer(actor)?; valid_state(state)?;
    let sd = state.try_borrow()?;
    if sd[67] != 0 { return Err(VaultError::Paused.into()); }
    if actor.address().as_ref() != &sd[2..34] && actor.address().as_ref() != &sd[34..66] {
        return Err(VaultError::Unauthorized.into());
    }
    let amount = u64::from_le_bytes(d[..8].try_into().map_err(|_| ProgramError::InvalidInstructionData)?);
    if amount == 0 { return Err(ProgramError::InvalidInstructionData); }
    let ix = TransferChecked::<&AccountView>::new(from, mint, to, if withdraw { state } else { actor }, amount, d[8]);
    if withdraw {
        let bump = [sd[66]];
        let seeds = [Seed::from(b"vault"), Seed::from(&sd[2..34]), Seed::from(bump.as_slice())];
        ix.invoke_signed_with_program(&[Signer::from(&seeds)], token_program.address())
    } else {
        ix.invoke_with_program(token_program.address())
    }
}

// [authority(s), state(w)]; new agent pubkey[32]
fn set_agent(a: &mut [AccountView], d: &[u8]) -> ProgramResult {
    if d.len() != 32 { return Err(ProgramError::InvalidInstructionData); }
    let [authority, state, ..] = a else { return Err(ProgramError::NotEnoughAccountKeys); };
    signer(authority)?; writable(state)?; valid_state(state)?; owner(authority, state)?;
    state.try_borrow_mut()?[34..66].copy_from_slice(d);
    Ok(())
}

// [authority(s), state(w)]; paused[u8]
fn set_paused(a: &mut [AccountView], d: &[u8]) -> ProgramResult {
    if d.len() != 1 || d[0] > 1 { return Err(ProgramError::InvalidInstructionData); }
    let [authority, state, ..] = a else { return Err(ProgramError::NotEnoughAccountKeys); };
    signer(authority)?; writable(state)?; valid_state(state)?; owner(authority, state)?;
    state.try_borrow_mut()?[67] = d[0];
    Ok(())
}

fn valid_state(a: &AccountView) -> ProgramResult {
    if a.owner() != &ID || a.data_len() != STATE_LEN { return Err(ProgramError::InvalidAccountData); }
    if a.try_borrow()?[0] != DISC { return Err(ProgramError::InvalidAccountData); }
    Ok(())
}
fn owner(authority: &AccountView, state: &AccountView) -> ProgramResult {
    if authority.address().as_ref() != &state.try_borrow()?[2..34] { return Err(VaultError::Unauthorized.into()); }
    Ok(())
}
fn signer(a: &AccountView) -> ProgramResult { if !a.is_signer() { Err(ProgramError::MissingRequiredSignature) } else { Ok(()) } }
fn writable(a: &AccountView) -> ProgramResult { if !a.is_writable() { Err(ProgramError::InvalidAccountData) } else { Ok(()) } }

#[repr(u32)]
enum VaultError { Unauthorized = 7000, Paused = 7001 }
impl From<VaultError> for ProgramError { fn from(e: VaultError) -> Self { ProgramError::Custom(e as u32) } }
