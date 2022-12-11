import { test } from './prepare-test-env-ava.js';

// eslint-disable-next-line no-new-func
const noop = new Function();
const isPromise = (x) => x && typeof x.then === 'function';
const requiredKeys = ['given', 'should', 'actual', 'expected'];
const concatToString = (keys, key, index) => keys + (index ? ', ' : '') + key;
const withRiteway = (TestFunction) => (test) => {
  const assert = (args = {}) => {
    const missing = requiredKeys.filter((k) => !Object.keys(args).includes(k));
    if (missing.length) {
      throw new Error(
        `The following parameters are required by \`assert\`: ${missing.reduce(
          concatToString,
          '',
        )}`,
      );
    }

    const {
      // initialize values to undefined so TypeScript doesn't complain
      given = undefined,
      should = '',
      actual = undefined,
      expected = undefined,
    } = args;

    test.deepEqual(actual, expected, `Given ${given}: should ${should}`);
  };

  const end = () => ({});
  const result = TestFunction(assert, end);

  if (isPromise(result)) return result.then(end);
};

const withAva =
  (tapeFn) =>
  (unit = '', TestFunction = noop) =>
    tapeFn(unit, withRiteway(TestFunction));

const describe = Object.assign(withAva(test), {
  only: withAva(test.is),
});
export { withRiteway, withAva, describe };
