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
  invertRatio,
  multiplyBy
} from '@agoric/zoe/src/contractSupport/ratio.js';
import { AmountMath } from '@agoric/ertp';
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
    console.log({ ratioEnv: env.ratios });
    Object.entries(env.issuersFromZcf).map(([keyword, issuer]) =>
      env.validationStore.init(keyword, {
        wantKeyword: `Li${keyword}`,
        ratioState: env.ratios[keyword],
        issuer
      })
    );
    return { ...env };
  });

const createMintTask = async (promises = []) => {
  return Promise.all(promises)
    .then(([LiAtoms, LiOsmos, LiUSD]) => {
      console.log(`Mints saved`, LiAtoms, LiOsmos);
      const { brand: LiAtomsBrand, issuer: LiAtomsIssuer } =
        LiAtoms.getIssuerRecord();
      const { brand: LiOsmosBrand, issuer: LiOsmosIssuer } =
        LiOsmos.getIssuerRecord();
      const { brand: LiUSDBrand, issuer: LiUSDIssuer } =
        LiUSD.getIssuerRecord();
      return Fn.ask.map(env => ({
        ...env,
        LiAtomsMint: {
          brand: LiAtomsBrand,
          issuer: LiAtomsIssuer,
          mint: LiAtoms
        },
        LiOsmosMint: {
          mint: LiOsmos,
          brand: LiOsmosBrand,
          issuer: LiOsmosIssuer
        },
        LiUSDMint: {
          mint: LiUSD,
          brand: LiUSDBrand,
          issuer: LiUSDIssuer
        }
      }));
    })
    .catch(e => {
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
  assertIssuerKeywords(zcf, ['Atoms', 'Osmos', 'USD']);
  const getDebtKeywords = store =>
    [...store.values()].map(x => x.wantKeyword).map(x => zcf.makeZCFMint(x));

  const { issuers, Ratios } = zcf.getTerms();
  const validationStore = makeStore('contract validation store');

  const { zcfSeat: adminSeat } = zcf.makeEmptySeatKit();
  const adminState = {
    adminSeat,
    reallocate: zcf.reallocate,
    swap: (leftSeat, rightSeat) => swap(zcf, leftSeat, rightSeat),
    internalStore: makeStore('balances'),
    ratios: Ratios,
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

  const traceState = () =>
    Fn.ask.map(env => {
      console.log('inner state::', { ...env });
      return Fn(x => x);
    });

  const handleCalculateMaxLtv = store => {
    [...store.entries()].map(([key, { brand, value, maxLtv }]) => {
      return store.set(key, {
        brand,
        value,
        maxLtv,
        maxAllowed: multiplyBy(AmountMath.make(brand, value), maxLtv)
      });
    });
    return store;
  };
  const runCalculateMaxLtv = () => {
    return Fn.ask.map(env => {
      [...env.userStore.entries()].map(([key, { brand, value, maxLtv }]) => {
        return env.userStore.set(key, {
          brand,
          value,
          maxLtv,
          maxAllowed: multiplyBy(AmountMath.make(brand, value), maxLtv)
        });
      });
      return Fn(x => ({ ...x }));
    });
  };
  const runHandleDepositOffer = runGetWantAmount()
    .chain(runMintWantAmount)
    .chain(runIncrementUser)
    .chain(runIncrementAdmin)
    .chain(runReallocate)
    .chain(runExitUserSeat)
    .chain(runRecordAdminDeposit);

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

  const runGetUsersLtv = () => Fn.ask.map(env => [...env.userStore.values()]);

  const hasEnough = ({ totalForUser }) =>
    runGetWantAmount().chain(({ value }) =>
      Fn.ask.map(env =>
        totalForUser > value
          ? Either.Right(env)
          : Either.Left(
              Error(
                'Error when checking LTV values. User does not have enough collateral to borrow'
              )
            )
      )
    );

  const addMaxAllowed = (balances = []) =>
    Fn.ask.map(env => ({
      ...env,
      totalForUser: balances.reduceRight(
        (acc, val) => acc + val.maxAllowed.value,
        0n
      )
    })); // ?

  const calculateRatio = runGetUsersLtv().chain(addMaxAllowed).chain(hasEnough);

  console.log(validationStore.get('Osmos'));
  const borrow = store => seat =>
    calculateRatio
      .map(trace('after calc'))
      .run(merge(contractAdminState, { userSeat: seat, userStore: store }))
      .fold(handleError('Error handling borrow.'), () =>
        createUserAccountResult(store)
      );

  const runGetRatio = () => Fn.ask.map(env => {});
  const addCollateral = store => seat =>
    runGetWantAmount()
      .chain(runMintWantAmount)
      .chain(runIncrementUser)
      .chain(runIncrementAdmin)
      .chain(runReallocate)
      .chain(runExitUserSeat)
      .chain(runRecordAdminDeposit)
      .chain(runRecordUserDeposit)
      .chain(runCalculateMaxLtv)
      .map(Either.of)
      .run(merge(contractAdminState, { userSeat: seat, userStore: store }))
      .fold(handleError('error handling mint payment offer'), () =>
        createUserAccountResult(store)
      );

  const openAccount = store => seat =>
    runHandleDepositOffer
      .chain(runRecordUserDeposit)
      .chain(runCalculateMaxLtv)
      .map(Either.of)
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
    getLiAtomsIssuer: () => contractAdminState.LiAtomsMint.issuer,
    getLiOsmosIssuer: () => contractAdminState.LiOsmosMint.issuer,
    getLiUSDIssuer: () => contractAdminState.LiUSDMint.issuer,
    getStore: () => adminState.internalStore
  });

  const publicFacet = Far('publicFacet', {
    // Make the token issuer public. Note that only the mint can
    // make new digital assets. The issuer is ok to make public.
    getLiUSDIssuer: () => contractAdminState.LiUSDMint.issuer,
    getLiAtomsIssuer: () => contractAdminState.LiAtomsMint.issuer,
    getLiOsmosIssuer: () => contractAdminState.LiOsmosMint.issuer
  });

  // Return the creatorFacet to the creator, so they can make
  // invitations for others to get payments of tokens. Publish the
  // publicFacet.
  return harden({ creatorFacet, publicFacet });
};

harden(start);
export { start };
