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
import {
  handleError,
  handleOfferSuccessMsg,
  merge,
  runExitUserSeat,
  runGetIssuerRecord,
  runGetWantAmount,
  runIncrementAdmin,
  runIncrementUser,
  runMintWantAmount,
  runReallocate,
} from './helpers.js';

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

  /** @type {OfferHandler} */
  const mintPayment = (seat) =>
    runGetWantAmount()
      .chain(runMintWantAmount)
      .chain(runIncrementAdmin)
      .chain(runIncrementUser)
      .chain(runReallocate)
      .chain(runExitUserSeat)
      .map(Either.of)
      .run(merge(contractAdminState, { userSeat: seat }))
      .fold(
        handleError('error handling mint payment offer'),
        handleOfferSuccessMsg(),
      );

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
