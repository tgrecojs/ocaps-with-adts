// @ts-check
/* global harden */
import '@agoric/zoe/exported.js';
import { Far } from '@endo/marshal';
import {
  assertIssuerKeywords,
  swap
} from '@agoric/zoe/src/contractSupport/zoeHelpers.js';
import { M, makeStore } from '@agoric/store';
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
  Fn.ask.map(env =>
    Object.entries(env.issuersFromZcf).map(([keyword, issuer]) =>
      env.validationStore.init(keyword, {
        wantKeyword: `Li${keyword}`,
        ratioState: env.ratios[keyword],
        issuer
      })
    )
  );

const createMintTask = async (promises = []) => {
  return E.when(
    Promise.all(promises).then(([LiAtoms, LiOsmos, LiUSD]) => {
      console.log(`Mints saved`, { LiAtoms, LiOsmos, LiUSD });
      const { brand: LiAtomsBrand, issuer: LiAtomsIssuer } =
        LiAtoms.getIssuerRecord();
      const { brand: LiOsmosBrand, issuer: LiOsmosIssuer } =
        LiOsmos.getIssuerRecord();
      const { brand: LiUSDBrand, issuer: LiUSDIssuer } =
        LiUSD.getIssuerRecord();
      return {
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
      };
    })
  ).catch(e => {
    console.error(`Failure with mint. Not added to Reserve`);
    throw e;
  });
};

const createGiveRecord = brands =>
  Object.entries(brands).map(([key, value]) => ({
    [key]: value.getAmountShape()
  }));

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
const mergeReader = inner => Fn(x => ({ ...x, ...inner }));

const start = async zcf => {
  assertIssuerKeywords(zcf, ['Atoms', 'Osmos', 'USD']);
  const getDebtKeywords = (array = []) =>
    Object.keys(array).map(x => zcf.makeZCFMint(`Li${x}`));

  const { issuers, Ratios, brands, ...rest } = zcf.getTerms();

  const { zcfSeat: adminSeat } = zcf.makeEmptySeatKit();

  const runCreateDebtMints = await createMintTask(getDebtKeywords(brands));

  const adminState = {
    adminSeat,
    reallocate: zcf.reallocate,
    internalStore: makeStore('balances'),
    ratios: Ratios,
    issuersFromZcf: issuers,
    validationStore: makeStore('contract validation store'),
    ...runCreateDebtMints
  };

  const contractAdminState = runSetupValidationStore()
    .chain(mergeReader)
    .run(adminState);

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
  const runCalculateMaxLtv = () =>
    Fn.ask.map(env =>
      [...env.userStore.entries()].map(([key, { brand, value, maxLtv }]) => {
        return env.userStore.set(key, {
          brand,
          value,
          maxLtv,
          maxAllowed: multiplyBy(AmountMath.make(brand, value), maxLtv)
        });
      })
    );

  const runHandleDepositOffer = runGetWantAmount()
    .chain(runMintWantAmount)
    .chain(runIncrementUser)
    .chain(runIncrementAdmin)
    .chain(runReallocate)
    .chain(runExitUserSeat)
    .chain(runRecordAdminDeposit)
    .chain(runRecordUserDeposit)
    .chain(runCalculateMaxLtv)
    .map(Either.of);

  /**
   *
   * References provided to an exisiting account holder for continued interation with the contract.
   *
   * @typedef {object} AccountOfferResult
   * @property {(getStore: Keyword) => Promise<MapStore<Keyword, Balance>>} getStore
   * @property {(borrowInvitation: Invitation) => Promise<Invitation>} borrowInvitation
   */

  /**
   * @param {(MapStore<Keyword, Balance>) => AccountOfferResult}
   * @param store
   */
  const accountOfferResult = store =>
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

  /**
   * @typedef {object} EitherFn
   * @property map
   */

  /**
   * @param {bigint} totalForUser total amount in USD a user can borrow.
   * @returns {EitherFn}
   */
  const runCheckCurrentLtv = totalForUser =>
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

  const calculateMaxBorrowValue = (balances = []) =>
    balances.reduceRight((acc, val) => acc + val.maxAllowed.value, 0n);

  const runValidateAccountBalances = runGetUsersLtv()
    .map(calculateMaxBorrowValue)
    .chain(runCheckCurrentLtv);

  /**
   * @typedef {object} MaxAllowed maximum about that a user can borrow, denominated in a brand (USD)
   * @property {Brand} brand
   * @property {bigint} value
   * /
   
  /**
   * @typedef {object} Balance
   * @property {Brand} brand
   * @property {MaxAllowed} maxAllowed total amount in USD a user can borrow.
   * @property {Ratio} maxLtv ratio of collateral price to USD
   * @property {bigint} value total tokens of that brand supplied
   */

  /**
   * Private key-value pair provided to an account upon successful creation.
   *
   * @typedef {(MapStore<'Keyword', Balance>)} AccountStore
   */

  /**
   * @param {(AccountStore)} store
   * @returns {(seat: OfferHandler) => AccountOfferResult}
   */
  const borrow = store => seat =>
    runValidateAccountBalances
      .run(merge(contractAdminState, { userSeat: seat, userStore: store }))
      .fold(handleError('Error handling borrow.'), () =>
        accountOfferResult(store)
      );

  const addCollateral = store => seat =>
    runHandleDepositOffer
      .run(merge(contractAdminState, { userSeat: seat, userStore: store }))
      .fold(handleError('error handling mint payment offer'), () =>
        accountOfferResult(store)
      );

  const openAccount = store => seat =>
    runHandleDepositOffer
      .run(
        merge(contractAdminState, {
          userSeat: seat,
          userStore: store
        })
      )
      .fold(handleError('error handling mint payment offer'), () =>
        accountOfferResult(store)
      );

  const creatorFacet = Far('creatorFacet', {
    // TG: Trying to use proposalShape doesn't work.
    makeInvitation: () =>
      zcf.makeInvitation(
        openAccount(makeStore('user store')),
        'mint a payment',
        undefined,
        M.splitRecord({ give: M.or(...createGiveRecord(brands)) })
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
