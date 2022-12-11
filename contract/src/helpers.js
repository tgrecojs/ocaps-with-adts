import { AmountMath } from '@agoric/ertp';
import { Fn, Either } from '../data.types.js';

const merge = (x, y) => ({ ...x, ...y });

const head = (arr = []) => {
  const [val] = arr;
  return val;
};
const parseKeyword = (offerSide) =>
  Object.entries(offerSide).map(([keyword, { brand, value }]) => {
    return { keyword, brand, value };
  });

const unboxKeyword = (x) => head(parseKeyword(x));

const runMintWantAmount = ({ keyword, value }) =>
  Fn.ask.map((env) =>
    env.zcfMint.mintGains(
      { [keyword]: AmountMath.make(env.brand, value) },
      env.adminSeat,
    ),
  );

const runGetWantAmount = () =>
  Fn.ask.map((env) => unboxKeyword(env.userSeat.getProposal().want));

const runIncrementAdmin = () =>
  Fn.ask.map((env) =>
    env.adminSeat.incrementBy(
      env.userSeat.decrementBy(harden(env.userSeat.getProposal().give)),
    ),
  );

const runReallocate = () =>
  Fn.ask.map((env) => env.reallocate(env.userSeat, env.adminSeat));

const runIncrementUser = () =>
  Fn.ask.map((env) =>
    env.userSeat.incrementBy(
      env.adminSeat.decrementBy(harden(env.userSeat.getProposal().want)),
    ),
  );

const runExitUserSeat = () => Fn.ask.map((env) => env.userSeat.exit());

const runGetIssuerRecord = Fn.ask.map((state) =>
  merge(state, state.zcfMint.getIssuerRecord()),
);
const runSwapReallocation = () =>
  Fn.ask.map((env) => env.swap(env.adminSeat, env.userSeat));
const handleOfferSuccessMsg =
  (message = 'Offer completed. You should receive a payment from Zoe') =>
  () =>
    `${message}`;
const handleError =
  (uiMessage = 'Default error message for UI') =>
  (error) => ({
    error,
    uiMessage,
  });

const id = (x) => x;

const traceADT = (Type) => (label) => (value) => {
  console.log(label, ':::', value);
  return Type((x) => x);
};
const trace = (label) => (value) => {
  console.log(label, ':::', value);
  return value;
};

const TraceReader = trace(Fn);
// safeSwap:: () => Fn(Either.Left | Either.Right)
const safeSwap = () =>
  Fn.ask.map((env) =>
    Either.tryCatch(() => env.swap(env.userSeat, env.adminSeat)),
  );
export {
  handleOfferSuccessMsg,
  handleError,
  id,
  merge,
  head,
  parseKeyword,
  runMintWantAmount,
  runGetIssuerRecord,
  runGetWantAmount,
  runIncrementAdmin,
  runReallocate,
  runIncrementUser,
  runExitUserSeat,
  runSwapReallocation,
  safeSwap,
  trace,
  traceADT,
  TraceReader,
};
