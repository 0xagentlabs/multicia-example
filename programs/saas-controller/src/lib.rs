#![no_std]

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    no_allocator, nostd_panic_handler, program_entrypoint,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

program_entrypoint!(process_instruction);
no_allocator!();
nostd_panic_handler!();

pub const ID: Address = Address::new_from_array([
    252, 121, 198, 33, 19, 183, 30, 217, 220, 1, 117, 255, 59, 112, 7, 103, 1, 166, 152, 235,
    182, 110, 99, 110, 234, 145, 134, 93, 4, 169, 106, 95,
]);
const VERSION: u8 = 1;
const TENANT_DISC: u8 = 1;
const MEMBER_DISC: u8 = 2;
const RESOURCE_DISC: u8 = 3;
const TENANT_LEN: usize = 140;
const MEMBER_LEN: usize = 76;
const RESOURCE_LEN: usize = 340;
const OWNER_ROLE: u8 = 3;
const ADMIN_ROLE: u8 = 2;

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (tag, payload) = data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => initialize_tenant(accounts, payload),
        1 => upsert_member(accounts, payload),
        2 => upsert_resource(accounts, payload),
        3 => set_paused(accounts, payload),
        4 => assert_access(accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// [authority(w,s), tenant(w), system]; tenant_id[32], name_len, name.
fn initialize_tenant(a: &mut [AccountView], d: &[u8]) -> ProgramResult {
    if d.len() < 33 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let n = d[32] as usize;
    if n == 0 || n > 64 || d.len() != 33 + n {
        return Err(ProgramError::InvalidInstructionData);
    }
    let [authority, tenant, system, ..] = a else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer_writable(authority)?;
    require_writable(tenant)?;
    if system.address() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let tid: &[u8; 32] = d[..32]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let (expected, bump) = Address::find_program_address(&[b"tenant", tid], &ID);
    if tenant.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let bump_seed = [bump];
    let seeds = [
        Seed::from(b"tenant"),
        Seed::from(tid.as_slice()),
        Seed::from(bump_seed.as_slice()),
    ];
    CreateAccount::with_minimum_balance(authority, tenant, TENANT_LEN as u64, &ID, None)?
        .invoke_signed(&[Signer::from(&seeds)])?;
    let mut out = tenant.try_borrow_mut()?;
    out.fill(0);
    out[0] = TENANT_DISC;
    out[1] = VERSION;
    out[2..34].copy_from_slice(tid);
    out[34..66].copy_from_slice(authority.address().as_ref());
    out[74] = bump;
    out[76] = n as u8;
    out[77..77 + n].copy_from_slice(&d[33..]);
    Ok(())
}

// [authority(w,s), tenant, wallet, member(w), system]; role, expires_at[i64].
fn upsert_member(a: &mut [AccountView], d: &[u8]) -> ProgramResult {
    if d.len() != 9 || d[0] > OWNER_ROLE {
        return Err(ProgramError::InvalidInstructionData);
    }
    let [authority, tenant, wallet, member, system, ..] = a else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer_writable(authority)?;
    require_program_account(tenant, TENANT_DISC, TENANT_LEN)?;
    require_writable(member)?;
    if system.address() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    {
        let td = tenant.try_borrow()?;
        if td[75] != 0 {
            return Err(ControllerError::TenantPaused.into());
        }
        if &td[34..66] != authority.address().as_ref() {
            return Err(ControllerError::Unauthorized.into());
        }
    }
    let expiry = i64::from_le_bytes(
        d[1..9]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    if expiry != 0 && expiry <= Clock::get()?.unix_timestamp {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (expected, bump) = Address::find_program_address(
        &[
            b"member",
            tenant.address().as_ref(),
            wallet.address().as_ref(),
        ],
        &ID,
    );
    if member.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if member.is_data_empty() {
        let bs = [bump];
        let seeds = [
            Seed::from(b"member"),
            Seed::from(tenant.address().as_ref()),
            Seed::from(wallet.address().as_ref()),
            Seed::from(bs.as_slice()),
        ];
        CreateAccount::with_minimum_balance(authority, member, MEMBER_LEN as u64, &ID, None)?
            .invoke_signed(&[Signer::from(&seeds)])?
    } else {
        require_program_account(member, MEMBER_DISC, MEMBER_LEN)?
    }
    let mut out = member.try_borrow_mut()?;
    out.fill(0);
    out[0] = MEMBER_DISC;
    out[1] = VERSION;
    out[2..34].copy_from_slice(tenant.address().as_ref());
    out[34..66].copy_from_slice(wallet.address().as_ref());
    out[66..74].copy_from_slice(&expiry.to_le_bytes());
    out[74] = d[0];
    out[75] = bump;
    Ok(())
}

// [actor(w,s), tenant, actor_member, resource(w), system]; id[32], role, hash[32], uri_len, uri.
fn upsert_resource(a: &mut [AccountView], d: &[u8]) -> ProgramResult {
    if d.len() < 66 || d[32] > OWNER_ROLE {
        return Err(ProgramError::InvalidInstructionData);
    }
    let n = d[65] as usize;
    if n > 192 || d.len() != 66 + n {
        return Err(ProgramError::InvalidInstructionData);
    }
    let [actor, tenant, actor_member, resource, system, ..] = a else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer_writable(actor)?;
    require_program_account(tenant, TENANT_DISC, TENANT_LEN)?;
    require_writable(resource)?;
    if system.address() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    authorize_manager(actor, tenant, actor_member)?;
    let rid: &[u8; 32] = d[..32]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let (expected, bump) =
        Address::find_program_address(&[b"resource", tenant.address().as_ref(), rid], &ID);
    if resource.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut version = 1u64;
    if resource.is_data_empty() {
        let bs = [bump];
        let seeds = [
            Seed::from(b"resource"),
            Seed::from(tenant.address().as_ref()),
            Seed::from(rid.as_slice()),
            Seed::from(bs.as_slice()),
        ];
        CreateAccount::with_minimum_balance(actor, resource, RESOURCE_LEN as u64, &ID, None)?
            .invoke_signed(&[Signer::from(&seeds)])?
    } else {
        require_program_account(resource, RESOURCE_DISC, RESOURCE_LEN)?;
        let old = resource.try_borrow()?;
        version = u64::from_le_bytes(
            old[131..139]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        )
        .checked_add(1)
        .ok_or(ControllerError::Overflow)?
    }
    let mut out = resource.try_borrow_mut()?;
    out.fill(0);
    out[0] = RESOURCE_DISC;
    out[1] = VERSION;
    out[2..34].copy_from_slice(tenant.address().as_ref());
    out[34..66].copy_from_slice(rid);
    out[66..98].copy_from_slice(&d[33..65]);
    out[98..130].copy_from_slice(actor.address().as_ref());
    out[131..139].copy_from_slice(&version.to_le_bytes());
    out[139] = d[32];
    out[140] = bump;
    out[141] = n as u8;
    out[142..142 + n].copy_from_slice(&d[66..]);
    Ok(())
}

// [authority(s), tenant(w)]; paused bool.
fn set_paused(a: &mut [AccountView], d: &[u8]) -> ProgramResult {
    if d.len() != 1 || d[0] > 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let [authority, tenant, ..] = a else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    require_program_account(tenant, TENANT_DISC, TENANT_LEN)?;
    require_writable(tenant)?;
    {
        let td = tenant.try_borrow()?;
        if &td[34..66] != authority.address().as_ref() {
            return Err(ControllerError::Unauthorized.into());
        }
    }
    tenant.try_borrow_mut()?[75] = d[0];
    Ok(())
}

// [actor(s), tenant, resource, member]. Owner may use any placeholder for member.
fn assert_access(a: &mut [AccountView]) -> ProgramResult {
    let [actor, tenant, resource, member, ..] = a else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !actor.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    require_program_account(tenant, TENANT_DISC, TENANT_LEN)?;
    require_program_account(resource, RESOURCE_DISC, RESOURCE_LEN)?;
    let td = tenant.try_borrow()?;
    if td[75] != 0 {
        return Err(ControllerError::TenantPaused.into());
    }
    let role = if &td[34..66] == actor.address().as_ref() {
        OWNER_ROLE
    } else {
        drop(td);
        require_program_account(member, MEMBER_DISC, MEMBER_LEN)?;
        let md = member.try_borrow()?;
        if &md[2..34] != tenant.address().as_ref() || &md[34..66] != actor.address().as_ref() {
            return Err(ControllerError::Unauthorized.into());
        }
        require_active_member(&md)?;
        md[74]
    };
    let rd = resource.try_borrow()?;
    if &rd[2..34] != tenant.address().as_ref() || role < rd[139] {
        return Err(ControllerError::Unauthorized.into());
    }
    Ok(())
}

fn authorize_manager(
    actor: &AccountView,
    tenant: &AccountView,
    member: &AccountView,
) -> ProgramResult {
    let td = tenant.try_borrow()?;
    if td[75] != 0 {
        return Err(ControllerError::TenantPaused.into());
    }
    if &td[34..66] == actor.address().as_ref() {
        return Ok(());
    }
    drop(td);
    require_program_account(member, MEMBER_DISC, MEMBER_LEN)?;
    let md = member.try_borrow()?;
    if &md[2..34] != tenant.address().as_ref()
        || &md[34..66] != actor.address().as_ref()
        || md[74] < ADMIN_ROLE
    {
        return Err(ControllerError::Unauthorized.into());
    }
    require_active_member(&md)?;
    Ok(())
}
fn require_active_member(data: &[u8]) -> ProgramResult {
    let expiry = i64::from_le_bytes(
        data[66..74]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    if expiry != 0 && expiry < Clock::get()?.unix_timestamp {
        Err(ControllerError::MembershipExpired.into())
    } else {
        Ok(())
    }
}
fn require_program_account(a: &AccountView, disc: u8, len: usize) -> ProgramResult {
    if !a.owned_by(&ID) {
        return Err(ProgramError::InvalidAccountOwner);
    }
    let d = a.try_borrow()?;
    if d.len() != len || d[0] != disc || d[1] != VERSION {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}
fn require_writable(a: &AccountView) -> ProgramResult {
    if !a.is_writable() {
        Err(ProgramError::InvalidAccountData)
    } else {
        Ok(())
    }
}
fn require_signer_writable(a: &AccountView) -> ProgramResult {
    if !a.is_signer() {
        Err(ProgramError::MissingRequiredSignature)
    } else {
        require_writable(a)
    }
}

#[repr(u32)]
enum ControllerError {
    Unauthorized = 0,
    TenantPaused = 1,
    Overflow = 2,
    MembershipExpired = 3,
}
impl From<ControllerError> for ProgramError {
    fn from(v: ControllerError) -> Self {
        ProgramError::Custom(v as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn layouts_are_stable() {
        assert_eq!(TENANT_LEN, 140);
        assert_eq!(MEMBER_LEN, 76);
        assert_eq!(RESOURCE_LEN, 340)
    }
    #[test]
    fn roles_are_ordered() {
        assert!(OWNER_ROLE > ADMIN_ROLE)
    }
}
