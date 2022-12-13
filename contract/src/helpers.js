import { AmountMath } from '@agoric/ertp';
import { Fn, Either } from '../data.types.js';

const { ask } = Fn;
const merge = (x, y) => ({ ...x, ...y });

const head = (arr = []) => {
  const [val] = arr;
  return val;
};

const initOrSet =
  store =>
  ({ keyword, brand, value }) =>
    !store.has(keyword)
      ? store.init(keyword, {
          value,
          brand
        })
      : store.set(keyword, {
          brand,
          value: store.get(keyword).value + value
        });

const parseKeyword = offerSide =>
  Object.entries(offerSide).map(([keyword, { brand, value }]) => {
    return { keyword, brand, value };
  });

const unboxKeyword = x => head(parseKeyword(x));

const runMintWantAmount = ({ keyword, value }) =>
  ask.map(env =>
    env.zcfMint.mintGains(
      { [keyword]: AmountMath.make(env.brand, value) },
      env.adminSeat
    )
  );

const runGetWantAmount = () =>
  ask.map(env => unboxKeyword(env.userSeat.getProposal().want));

const runGetGiveAmount = () =>
  ask.map(env => unboxKeyword(env.userSeat.getProposal().give));

const runIncrementAdmin = () =>
  ask.map(env =>
    env.adminSeat.incrementBy(
      env.userSeat.decrementBy(harden(env.userSeat.getProposal().give))
    )
  );

const runReallocate = () =>
  ask.map(env => env.reallocate(env.userSeat, env.adminSeat));

const runIncrementUser = () =>
  ask.map(env =>
    env.userSeat.incrementBy(
      env.adminSeat.decrementBy(harden(env.userSeat.getProposal().want))
    )
  );

const runExitUserSeat = () => ask.map(env => env.userSeat.exit());

const runGetIssuerRecord = () =>
  ask.map(state => ({ ...state, ...state.zcfMint.getIssuerRecord() }));
const runSwapReallocation = () =>
  ask.map(env => env.swap(env.adminSeat, env.userSeat));
const handleOfferSuccessMsg =
  (message = 'Offer completed. You should receive a payment from Zoe') =>
  () =>
    `${message}`;
const handleError =
  (uiMessage = 'Default error message for UI') =>
  error => ({
    error,
    uiMessage
  });

const id = x => x;

const traceADT = Type => label => value => {
  console.log(label, ':::', value);
  return Type(x => x);
};
const trace = label => value => {
  console.log(label, ':::', value);
  return value;
};

const TraceReader = trace(Fn);
// safeSwap:: () => Fn(Either.Left | Either.Right)
const safeSwap = () =>
  ask.map(state =>
    Either.tryCatch(() => state.swap(state.userSeat, state.adminSeat))
  );

const runRecordAdminDeposit = () =>
  runGetGiveAmount().chain(giveObject =>
    Fn.ask.map(env => {
      return Either.tryCatch(() => initOrSet(env.internalStore)(giveObject));
    })
  );

const runRecordUserDeposit = () =>
  runGetWantAmount().chain(giveObject =>
    Fn.ask.map(env => {
      return Either.tryCatch(() => initOrSet(env.userStore)(giveObject));
    })
  );

export {
  handleOfferSuccessMsg,
  handleError,
  id,
  merge,
  head,
  parseKeyword,
  initOrSet,
  runMintWantAmount,
  runGetIssuerRecord,
  runGetWantAmount,
  runIncrementAdmin,
  runReallocate,
  runIncrementUser,
  runExitUserSeat,
  runSwapReallocation,
  runGetGiveAmount,
  runRecordAdminDeposit,
  runRecordUserDeposit,
  safeSwap,
  trace,
  traceADT,
  TraceReader
};
