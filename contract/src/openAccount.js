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
  merge,
  runExitUserSeat,
  runGetIssuerRecord,
  runGetWantAmount,
  runIncrementAdmin,
  runIncrementUser,
  runMintWantAmount,
  runReallocate,
  runRecordAdminDeposit,
  runRecordUserDeposit
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

const start = async zcf => {
  assertIssuerKeywords(zcf, ['Dollars', 'Atoms']);
  const { dollarsToAtomRatio } = await zcf.getTerms();

  console.log({ dollarsToAtomRatio });
  const { zcfSeat: adminSeat } = zcf.makeEmptySeatKit();
  const zcfMint = await zcf.makeZCFMint('Tokens');
  const adminState = {
    zcfMint,
    adminSeat,
    reallocate: zcf.reallocate,
    swap: (leftSeat, rightSeat) => swap(zcf, leftSeat, rightSeat),
    internalStore: makeStore('balances'),
    ratios: {
      dollarsToAtomRatio
    }
  };

  const contractAdminState = runGetIssuerRecord.run(adminState);

  const runHandleDepositOffer = runGetWantAmount()
    .chain(runMintWantAmount)
    .chain(runIncrementAdmin)
    .chain(runIncrementUser)
    .chain(runReallocate)
    .chain(runExitUserSeat)
    .chain(runRecordAdminDeposit);

  const borrow = store => seat => {
    // todo
    return 'borrow success!';
  };

  const createUserAccountResult = store =>
    Far('accountHolderFacet', {
      getStore: () => store,
      addCollateralInvitation: () =>
        zcf.makeInvitation(
          // eslint-disable-next-line no-use-before-define
          addCollateral(store),
          'add collateral to your balanace'
        ),
      borrowInvitation: () =>
        zcf.makeInvitation(
          // eslint-disable-next-line no-use-before-define
          borrow(store),
          'add collateral to your balanace'
        )
    });

  const addCollateral = store => seat =>
    runHandleDepositOffer
      .chain(runRecordUserDeposit)
      .run(merge(contractAdminState, { userSeat: seat, userStore: store }))
      .fold(handleError('error handling mint payment offer'), () =>
        createUserAccountResult(store)
      );

  const openAccount = store => seat =>
    runHandleDepositOffer
      .chain(runRecordUserDeposit)
      .run(
        merge(contractAdminState, {
          userSeat: seat,
          userStore: store
        })
      )
      .fold(handleError('error handling mint payment offer'), () =>
        createUserAccountResult(store)
      );

  const creatorFacet = Far('creatorFacet', {
    // TG: Trying to use proposalShape doesn't work.
    makeInvitation: () =>
      zcf.makeInvitation(
        openAccount(makeStore('user store')),
        'mint a payment'
      ),
    getTokenIssuer: () => zcfMint.getIssuerRecord().issuer,
    getStore: () => adminState.internalStore
  });

  const publicFacet = Far('publicFacet', {
    getTokenIssuer: () => zcfMint.getIssuerRecord().issuer
  });

  // Return the creatorFacet to the creator, so they can make
  // invitations for others to get payments of tokens. Publish the
  // publicFacet.
  return harden({ creatorFacet, publicFacet });
};

harden(start);
export { start };
