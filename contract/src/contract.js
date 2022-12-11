// @ts-check
/* global harden */
import '@agoric/zoe/exported.js';
import { AmountMath, AmountShape } from '@agoric/ertp';
import { Far } from '@endo/marshal';
import {
  assertIssuerKeywords,
  assertProposalShape,
  fitProposalShape,
  swap,
  swapExact,
} from '@agoric/zoe/src/contractSupport/zoeHelpers.js';
import { M } from '@agoric/store';
import { Fn, Either } from '../data.types.js';

const trace = (label) => (value) => {
  console.log(label, ':::', value);
  return value;
};
const traceADT = (Type) => (label) => (value) => {
  console.log(label, ':::', value);
  return Type((x) => x);
};

const FnTracer = traceADT(Fn);

// TG: This is for research. I can't to be figure out how to sucessfully proposal shape.
// Need to learn more about using the M API
// Relevant links:
// https://github.com/Agoric/agoric-sdk/search?q=ProposalShape
// https://github.com/Agoric/agoric-sdk/blob/master/packages/zoe/src/contractSupport/zoeHelpers.js#L108-L110
// https://github.com/Agoric/agoric-sdk/blob/master/packages/zoe/src/typeGuards.js#L27-L45
//
// export const AmountKeywordRecordShape = M.recordOf(M.string(), AmountShape);
// export const AmountPatternKeywordRecordShape = M.recordOf(
//   M.string(),
//   M.pattern(),
// );
// export const makeHandleShape = (name) => M.remotable(`${name}Handle`);
// export const TimerShape = makeHandleShape('timer');
// export const FullProposalShape = harden({
//   want: AmountPatternKeywordRecordShape,
//   give: AmountKeywordRecordShape,
//   // To accept only one, we could use M.or rather than M.splitRecord,
//   // but the error messages would have been worse. Rather,
//   // cleanProposal's assertExit checks that there's exactly one.
//   exit: M.splitRecord({}),
// });
// export const ProposalShape = M.splitRecord({}, FullProposalShape, {});

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
const merge = (x, y) => ({ ...x, ...y });

const runGetIssuerRecord = Fn.ask.map((state) =>
  merge(state, state.zcfMint.getIssuerRecord()),
);
const runSwapReallocation = () =>
  Fn.ask.map((env) => env.swap(env.adminSeat, env.userSeat));

/**
 * This is a very simple contract that creates a new issuer and mints payments
 * from it, in order to give an example of how that can be done.  This contract
 * sends new tokens to anyone who has an invitation.
 *
 * The expectation is that most contracts that want to do something similar
 * would use the ability to mint new payments internally rather than sharing
 * that ability widely as this one does.
 *
 * To pay others in tokens, the creator of the instance can make
 * invitations for them, which when used to make an offer, will payout
 * the specified amount of tokens.
 *
 * @type {ContractStartFn}
 */

const start = async (zcf) => {
  assertIssuerKeywords(zcf, ['Dollars']);

  const { zcfSeat: adminSeat } = zcf.makeEmptySeatKit();
  const zcfMint = await zcf.makeZCFMint('Tokens');

  const adminState = {
    zcfMint,
    adminSeat,
    reallocate: zcf.reallocate,
    swap: (leftSeat, rightSeat) => swap(zcf, leftSeat, rightSeat),
  };

  const contractAdminState = runGetIssuerRecord.run(adminState);

  const offerReaderAlternative = Fn.of(runGetWantAmount)
    .chain(runGetWantAmount)
    .chain(runMintWantAmount)
    .chain(runSwapReallocation);

  const offerReader = Fn.of(runGetWantAmount)
    .chain(runGetWantAmount)
    .chain(runMintWantAmount)
    // .chain(runSwapReallocation) eliminates the need for this
    .chain(runIncrementAdmin)
    // and this...
    .chain(runIncrementUser)
    // and this...
    .chain(runReallocate)
    // and this...
    .chain(runExitUserSeat);

  const handleSuccess = (
    message = 'Offer completed. You should receive a payment from Zoe',
  ) => `${message}`;

  /** @type {OfferHandler} */
  const mintPayment = (seat) => {
    // swap out offerReader for offerReaderAlternative and see what happens:
    // hint: it will break the getOfferResult() test ;)
    const result = offerReader
      .map(Either.of)
      .run(merge(contractAdminState, { userSeat: seat }));

    return result.fold((err) => err, handleSuccess);
  };

  const creatorFacet = Far('creatorFacet', {
    // TG: Trying to use proposalShape doesn't work.
    makeInvitation: () => zcf.makeInvitation(mintPayment, 'mint a payment'),
    getTokenIssuer: () => zcfMint.getIssuerRecord().issuer,
  });

  const publicFacet = Far('publicFacet', {
    // Make the token issuer public. Note that only the mint can
    // make new digital assets. The issuer is ok to make public.
    getTokenIssuer: () => zcfMint.getIssuerRecord().issuer,
  });

  // Return the creatorFacet to the creator, so they can make
  // invitations for others to get payments of tokens. Publish the
  // publicFacet.
  return harden({ creatorFacet, publicFacet });
};

harden(start);
export { start };
