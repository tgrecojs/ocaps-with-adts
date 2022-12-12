// @ts-check
/* global harden */
import '@agoric/zoe/exported.js';
import { Far } from '@endo/marshal';
import {
  assertIssuerKeywords,
  swap
} from '@agoric/zoe/src/contractSupport/zoeHelpers.js';
import { makeStore } from '@agoric/store';
import {
  handleError,
  handleOfferSuccessMsg,
  merge,
  runGetGiveAmount,
  runGetIssuerRecord,
  runGetWantAmount,
  runMintWantAmount,
  safeSwap
} from './helpers.js';
import { Fn, Either } from '../data.types.js';

/**
 * This contract allows users to exchange "Dollars" from "Tokens".
 * mintPayment invitation requires a user to { give: {Dollars: dollarAmount} } and { want: {Token: tokensAmount} }
 * the offer will succeed if both parties
 *
 * @type {ContractStartFn}
 */

const start = async zcf => {
  assertIssuerKeywords(zcf, ['Dollars']);

  // TODO: begin
  // const safeAssertKeys = tryCatch(() => assertIssuerKeywords(zcf, ['Dollar']));
  const { zcfSeat: adminSeat } = zcf.makeEmptySeatKit();
  const zcfMint = await zcf.makeZCFMint('Tokens');

  const adminState = {
    zcfMint,
    adminSeat,
    reallocate: zcf.reallocate,
    swap: (leftSeat, rightSeat) => swap(zcf, leftSeat, rightSeat),
    internalStore: makeStore('deposit balances')
  };

  const contractAdminState = runGetIssuerRecord.run(adminState);

  /** @type {OfferHandler} */
  const mintPayment = seat =>
    runGetWantAmount()
      .chain(runMintWantAmount)
      .chain(safeSwap)
      .run(merge(contractAdminState, { userSeat: seat }))
      .fold(
        handleError('error handling mintPayment offer'),
        handleOfferSuccessMsg()
      );

  const creatorFacet = Far('creatorFacet', {
    // TG: Trying to use proposalShape doesn't work.
    makeInvitation: () => zcf.makeInvitation(mintPayment, 'mint a payment'),
    getLiAtomIssuer: () => zcfMint.getIssuerRecord().issuer,
    getStore: () => adminState.internalStore
  });

  const publicFacet = Far('publicFacet', {
    // Make the token issuer public. Note that only the mint can
    // make new digital assets. The issuer is ok to make public.
    getLiAtomIssuer: () => zcfMint.getIssuerRecord().issuer
  });

  // Return the creatorFacet to the creator, so they can make
  // invitations for others to get payments of tokens. Publish the
  // publicFacet.
  return harden({ creatorFacet, publicFacet });
};

harden(start);
export { start };
