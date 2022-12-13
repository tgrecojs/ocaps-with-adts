// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { describe } from './prepare-riteway.js';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';

const { brand, issuer, mint } = makeIssuerKit('Osmos');
const dollars = x => AmountMath.make(brand, x);

const Sum = value => ({
  value,
  concat: x => Sum(value + x.value),
  inspect: () => `Sum(${x})`
});
const AmountType = x => ({
  value: x,
  concat: other => AmountType(AmountMath.add(x, other.value)),
  empty: () => AmountType(x)
});

const fold =
  monoid =>
  (data = []) =>
    data.reduce((acc, val) => {
      return acc.concat(monoid(val)), monoid.empty();
    });

describe('Amount:: type', async assert => {
  const testAmount = dollars(500n);
  // const otherAmount = await E(AmountRemotable).AmountType(200n);

  const amounts = [AmountMath.make(brand, 1000n), AmountMath.make(brand, 200n)];

  const [amountOne, amountTwo] = amounts;
  const second = AmountType(amountTwo);
  const actual = AmountType(amountOne);
  await assert({
    given: 'runCreateAmount(100n)',
    should: 'update the initial state to include a new value',
    actual: actual.empty().value,
    expected: dollars(1000n)
  });
  await assert({
    given: 'actual.concat(second)',
    should: 'update the initial state to include a new value',
    actual: actual.concat(second).empty().value,
    expected: dollars(1200n)
  });
  await assert({
    given: 'actual.concat(second)',
    should: 'update the initial state to include a new value',
    actual: actual.empty().concat(second).empty().value,
    expected: dollars(1200n)
  });
  await assert({
    given: 'actual.concat(second)',
    should: 'update the initial state to include a new value',
    actual: actual
      .concat(second)
      .concat(AmountType(dollars(5000n)).empty())
      .empty().value,
    expected: dollars(6200n)
  });
  const testNumbers = [10n, 300n, 4000n, 50000n, 1n, 50000n];
  const ints = testNumbers.map(x => AmountMath.make(brand, x));
  const expectedValue = testNumbers.reduceRight((acc, val) => acc + val, 0n);
  const reducedAmount = ints
    .map(AmountType)
    .reduce((acc, val) => acc.concat(val));
  await assert({
    given: 'an array of payments',
    should: 'update the initial state to include a new value',
    actual: reducedAmount.empty().value,
    expected: dollars(expectedValue)
  });
});
