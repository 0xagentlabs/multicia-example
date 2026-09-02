import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  counterAddress,
  counterInstruction,
  OPERATION_FEE_LAMPORTS,
  PROGRAM_ID,
} from "../lib/counter";

test("derives a stable authority-scoped counter PDA", () => {
  const authority = new PublicKey("11111111111111111111111111111112");
  assert.equal(counterAddress(authority).toBase58(), counterAddress(authority).toBase58());
  assert.notEqual(counterAddress(authority).toBase58(), counterAddress(Keypair.generate().publicKey).toBase58());
});

test("builds the paid increment instruction with strict account order", () => {
  const authority = Keypair.generate().publicKey;
  const beneficiary = Keypair.generate().publicKey;
  const instruction = counterInstruction(1, authority, beneficiary);
  assert.ok(instruction.programId.equals(PROGRAM_ID));
  assert.deepEqual([...instruction.data], [1]);
  assert.equal(instruction.keys.length, 4);
  assert.deepEqual(
    instruction.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]),
    [[true, true], [false, true], [false, true], [false, false]],
  );
  assert.equal(OPERATION_FEE_LAMPORTS, 1_000_000);
});
