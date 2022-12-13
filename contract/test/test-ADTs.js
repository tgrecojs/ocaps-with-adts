// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { describe } from './prepare-riteway.js';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';
import { Fn, Fn as Reader } from '../data.types.js';

const { brand, issuer, mint } = makeIssuerKit('Osmos');
const dollars = (x) => AmountMath.make(brand, x);

const runCreateAmount = (x) =>
  Reader((state) => AmountMath.make(state.brand, x));
// This is the same as Fn.ask.map(state => AmountMath(state.brand, x))
// Fn.ask.map makes values from the .run() method available.
const runMintPayment = (amount) =>
  Fn.ask.map((state) => state.mint.mintPayment(amount));
const runDepositPayment = (payment) =>
  Fn.ask.map((state) => state.purse.deposit(payment));

describe('Mint/Purse using ADTs :: runCreateAmount', async (assert) => {
  const initialState = { brand, issuer, mint, purse: issuer.makeEmptyPurse() };
  const testAmount = dollars(500n);

  const actual = runCreateAmount(500n);
  await assert({
    given: 'runCreateAmount(100n)',
    should: 'update the initial state to include a new value',
    actual: actual.run(initialState),
    expected: testAmount,
  });
});

describe('Mint/Purse using ADTs :: runMintPayment reader', async (assert) => {
  const initialState = { brand, issuer, mint, purse: issuer.makeEmptyPurse() };

  const setupTokensValue = 1000n;
  const setupPayment = runCreateAmount(setupTokensValue).chain(runMintPayment);

  const actualPayment = setupPayment.run(initialState);
  assert({
    given: 'a valid amount',
    should: 'use the amount to mint a payment',
    actual: await initialState.issuer.isLive(actualPayment),
    expected: true,
  });
});

const getPurseBalance = () => Fn.ask.map((env) => env.purse.getCurrentAmount());
describe('Mint/Purse using ADTs :: runDeposit reader', async (assert) => {
  const initialState = { brand, issuer, mint, purse: issuer.makeEmptyPurse() };

  const setupTokensValue = 2000n;
  const setupDeposit = runCreateAmount(setupTokensValue)
    .chain(runMintPayment)
    .chain(runDepositPayment);

  assert({
    given: 'a valid paymand',
    should: 'deposit the payment in the purse',
    actual: setupDeposit.run(initialState),
    expected: dollars(setupTokensValue),
  });

  const setupDepositAndCheckBalance = setupDeposit
    .chain(getPurseBalance)
    .run(initialState);

  assert({
    given: 'a valid payment',
    should: 'update the purse balance to reflect the correct amount',
    actual: setupDepositAndCheckBalance,
    // .run() has been called on twice on setupDeposit.
    // it's state will persist, therefore both payments are now in the purse
    expected: dollars(setupTokensValue * 2n),
  });
});
