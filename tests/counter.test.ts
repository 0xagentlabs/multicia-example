import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { configAddress, counterAddress, counterInstruction, OPERATION_FEE_LAMPORTS, PROGRAM_ID, setOwnerInstruction, vaultAddress, withdrawInstruction } from "../lib/counter";

test("derives a stable authority-scoped counter PDA", () => {
  const authority = new PublicKey("11111111111111111111111111111112");
  assert.equal(counterAddress(authority).toBase58(), counterAddress(authority).toBase58());
  assert.notEqual(counterAddress(authority).toBase58(), counterAddress(Keypair.generate().publicKey).toBase58());
});

test("builds the paid increment instruction with strict account order", () => {
  const authority = Keypair.generate().publicKey;
  const instruction = counterInstruction(1, authority);
  assert.ok(instruction.programId.equals(PROGRAM_ID));
  assert.deepEqual([...instruction.data], [1]);
  assert.equal(instruction.keys.length, 4);
  assert.deepEqual(
    instruction.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]),
    [[true, true], [false, true], [false, true], [false, false]],
  );
  assert.equal(OPERATION_FEE_LAMPORTS, 1_000_000);
  assert.ok(instruction.keys[2].pubkey.equals(vaultAddress()));
});

test("builds one-time owner configuration with global config and vault PDAs", () => {
  const candidate = Keypair.generate().publicKey;
  const instruction = setOwnerInstruction(candidate);
  assert.deepEqual([...instruction.data], [3]);
  assert.ok(instruction.keys[1].pubkey.equals(configAddress()));
  assert.ok(instruction.keys[2].pubkey.equals(vaultAddress()));
});

test("encodes withdraw-all as a zero u64 and sends funds to owner", () => {
  const owner = Keypair.generate().publicKey;
  const instruction = withdrawInstruction(owner);
  assert.equal(instruction.data.length, 9);
  assert.equal(instruction.data[0], 4);
  assert.equal(instruction.data.readBigUInt64LE(1), 0n);
  assert.ok(instruction.keys[3].pubkey.equals(owner));
});
