// @ts-check
/* global harden */
import '@agoric/zoe/exported.js';
import { Far } from '@endo/marshal';
import {
  assertIssuerKeywords,
  swap
} from '@agoric/zoe/src/contractSupport/zoeHelpers.js';
import { makeStore } from '@agoric/store';
import { E } from '@endo/eventual-send';
import {
  handleError,
  id,
  merge,
  runExitUserSeat,
  runGetIssuerRecord,
  runGetWantAmount,
  runIncrementAdmin,
  runIncrementUser,
  runMintWantAmount,
  runReallocate,
  runRecordAdminDeposit,
  runRecordUserDeposit,
  trace,
  TraceReader
} from './helpers.js';
import { Either, Fn, Task } from '../data.types.js';

const runSetupValidationStore = () =>
  Fn.ask.map(env => {
    Object.entries(env.issuersFromZcf).map(([keyword, props]) =>
      env.validationStore.init(keyword, {
        wantKeyword: `Li${keyword}`,
        issuer: props
      })
    );
    return { ...env };
  });
const createMintTask = async (promises = []) => {
  return E.when(Promise.all(promises), ([LiAtoms, LiDollars]) => {
    console.log(`Mints saved`, LiAtoms, LiDollars);
    const { brand: LiAtomsBrand, issuer: LiAtomsIssuer } =
      LiAtoms.getIssuerRecord();
    const { brand: LiDollarsBrand, issuer: LiDollarsIssuer } =
      LiDollars.getIssuerRecord();

    return Fn.ask.map(env => ({
      ...env,
      LiAtomsMint: {
        brand: LiAtomsBrand,
        issuer: LiAtomsIssuer,
        mint: LiAtoms
      },
      LiDollarsMint: {
        mint: LiDollars,
        brand: LiDollarsBrand,
        issuer: LiDollarsIssuer
      }
    }));
  }).catch(e => {
    console.error(`Failure with mint. Not added to Reserve`);
    throw e;
  });
};
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
  const getDebtKeywords = store =>
    [...store.values()].map(x => x.wantKeyword).map(x => zcf.makeZCFMint(x));

  const { issuers, dollarsToAtomsRatio } = zcf.getTerms();
  const validationStore = makeStore('contract validation store');

  const { zcfSeat: adminSeat } = zcf.makeEmptySeatKit();
  const adminState = {
    adminSeat,
    reallocate: zcf.reallocate,
    swap: (leftSeat, rightSeat) => swap(zcf, leftSeat, rightSeat),
    internalStore: makeStore('balances'),
    dollarsToAtomsRatio,
    issuersFromZcf: issuers
  };
  const mergeReader = inner => Fn(x => ({ ...x, ...inner }));

  const initContractAdminState = runSetupValidationStore().run({
    ...adminState,
    issuersFromZcf: issuers,
    validationStore
  });
  const runCreateDebtMints = await createMintTask(
    getDebtKeywords(initContractAdminState.validationStore)
  );

  const contractAdminState = runCreateDebtMints
    .chain(mergeReader)
    .run(initContractAdminState);

  const runHandleDepositOffer = runGetWantAmount()
    .chain(runMintWantAmount)
    .map(trace('after runMintWantAmount'))
    .chain(runIncrementUser)
    .map(trace('after runIncrementUser'))
    .chain(runIncrementAdmin)
    .map(trace('after runIncrementAdmin'))
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
    runGetWantAmount()
      .chain(runMintWantAmount)
      .map(trace('after runMintWantAmount'))
      .chain(runIncrementUser)
      .map(trace('after runIncrementUser'))
      .chain(runIncrementAdmin)
      .map(trace('after runIncrementAdmin'))
      .chain(runReallocate)
      .chain(runExitUserSeat)
      .chain(runRecordAdminDeposit)
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
    getLiDollarsIssuer: () => contractAdminState.LiDollarsMint.issuer,
    getStore: () => adminState.internalStore
  });

  const publicFacet = Far('publicFacet', {
    // Make the token issuer public. Note that only the mint can
    // make new digital assets. The issuer is ok to make public.
    getLiAtomsIssuer: () => contractAdminState.LiAtomsMint.issuer,
    getLiDollarsIssuer: () => contractAdminState.LiDollarsMint.issuer
  });

  // Return the creatorFacet to the creator, so they can make
  // invitations for others to get payments of tokens. Publish the
  // publicFacet.
  return harden({ creatorFacet, publicFacet });
};

harden(start);
export { start };
