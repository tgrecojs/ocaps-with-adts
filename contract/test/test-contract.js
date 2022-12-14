// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { test } from './prepare-test-env-ava.js';
import path from 'path';

import bundleSource from '@endo/bundle-source';

import { E } from '@endo/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/tools/fakeVatAdmin.js';
import { makeZoeKit } from '@agoric/zoe';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';
import {
  invertRatio,
  makeRatio,
  multiplyBy
} from '@agoric/zoe/src/contractSupport/ratio.js';
import { trace } from '../src/helpers.js';

const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);

const contractPath = `${dirname}/../src/contract.js`;
const {
  brand: osmoBrand,
  issuer: osmoIssuer,
  mint: osmoMint
} = makeIssuerKit('Osmos');
const osmo = x => AmountMath.make(osmoBrand, x);
const {
  brand: atomBrand,
  issuer: atomIssuer,
  mint: atomMint
} = makeIssuerKit('atom');
const {
  brand: usdBrand,
  issuer: usdIssuer,
  mint: usdMint
} = makeIssuerKit('usd');
const atoms = x => AmountMath.make(atomBrand, x);
const usd = x => AmountMath.make(usdBrand, x);
test('zoe - mint payments', async t => {
  const { zoeService } = makeZoeKit(makeFakeVatAdmin().admin);
  const feePurse = E(zoeService).makeFeePurse();
  const zoe = E(zoeService).bindDefaultFeePurse(feePurse);

  // pack the contract
  const bundle = await bundleSource(contractPath);

  // install the contract
  const installation = E(zoe).install(bundle);

  const maxAtomRatio = makeRatio(1n, atomBrand, 7n, usdBrand);

  const maxOsmoRation = makeRatio(10n, osmoBrand, 4n, usdBrand);
  const osmoInUSD = invertRatio(maxOsmoRation);
  const atomInUSD = invertRatio(maxAtomRatio);

  const calculateMaxBorrow = amount => multiplyBy(amount, atomInUSD);
  const calculateMaxBorrowOsmo = amount => multiplyBy(amount, osmoInUSD);

  t.deepEqual(calculateMaxBorrow(atoms(10n)), usd(70n));
  t.deepEqual(calculateMaxBorrowOsmo(osmo(100n)), usd(40n));
  const { creatorFacet, instance } = await E(zoe).startInstance(
    installation,
    {
      Osmos: osmoIssuer,
      Atoms: atomIssuer,
      USD: usdIssuer
    },
    {
      Ratios: {
        Atoms: atomInUSD,
        Osmos: osmoInUSD,
        USD: makeRatio(1n, usdBrand)
      }
    }
  );
  // Let's get the liUSDIssuer from the contract so we can evaluate
  // what we get as our payout
  const publicFacet = E(zoe).getPublicFacet(instance);
  const LiOsmoIssuer = E(publicFacet).getLiOsmosIssuer();
  const LiOsmoBrand = await E(LiOsmoIssuer).getBrand();
  const LiAtomsIssuer = E(publicFacet).getLiAtomsIssuer();
  const LiAtomsBrand = await E(LiAtomsIssuer).getBrand();
  const LiUSDIssuer = await E(publicFacet).getLiUSDIssuer();
  const LiUSDBrand = await E(LiUSDIssuer).getBrand();

  // Alice makes an invitation for Bob that will give him 1000 tokens
  const invitation = E(creatorFacet).makeInvitation();

  // Bob makes an offer using the invitation
  const seat = await E(zoe).offer(
    invitation,
    {
      give: { Osmos: osmo(100n) },
      want: { LiOsmos: AmountMath.make(LiOsmoBrand, 100n) }
    },
    { Osmos: osmoMint.mintPayment(osmo(100n)) }
  );

  t.deepEqual(await seat.hasExited(), true);

  const paymentP = await seat.getPayout('LiOsmos');
  const tokenPayoutAmount = await E(LiOsmoIssuer).getAmountOf(paymentP);
  const LiOsmoAmount = x => AmountMath.make(LiOsmoBrand, x);
  t.deepEqual(tokenPayoutAmount, LiOsmoAmount(100n));

  const seatOneResult = await seat.getOfferResult();
  t.truthy(
    seatOneResult.getStore,
    'openAccount should return a reference to getStore'
  );
  t.truthy(
    seatOneResult.addCollateralInvitation,
    'openAccount should return a reference to addCollateral'
  );

  t.deepEqual(seatOneResult.getStore().get('Osmos').value, 100n);
  // Let's get the LiOsmoIssuer from the contract so we can evaluate
  // what we get as our payout

  const store = await E(creatorFacet).getStore();
  // t.deepEqual(store.get('Osmos'), { brand, value: 100n });

  // Bob makes an offer using the invitation
  const seatTwo = await E(zoe).offer(
    E(creatorFacet).makeInvitation(),
    {
      give: { Atoms: atoms(200n) },
      want: { LiAtoms: AmountMath.make(LiAtomsBrand, 200n) }
    },
    { Atoms: atomMint.mintPayment(atoms(200n)) }
  );
  const seatTwoPayment = await seatTwo.getPayout('LiAtoms');
  const seatTwoPaymentAmt = await E(LiAtomsIssuer).getAmountOf(seatTwoPayment);
  const liAtomsAmount = x => AmountMath.make(LiAtomsBrand, x);

  const seatTwoResult = await seatTwo.getOfferResult();

  t.deepEqual(seatTwoPaymentAmt, liAtomsAmount(200n));
  t.deepEqual(store.get('Atoms').value, 200n);
  t.deepEqual(store.get('Atoms').brand, atomBrand);

  t.deepEqual(await seatTwo.hasExited(), true);

  const addCollateralSeat = await E(zoe).offer(
    E(seatOneResult).addCollateralInvitation(),
    {
      give: { Osmos: osmo(900n) },
      want: { LiOsmos: AmountMath.make(LiOsmoBrand, 900n) }
    },
    { Osmos: osmoMint.mintPayment(osmo(900n)) }
  );
  const addResult = await addCollateralSeat.getOfferResult();
  const addUSDSeat = await E(zoe).offer(
    E(seatOneResult).addCollateralInvitation(),
    {
      give: { USD: usd(1200n) },
      want: { LiUSD: AmountMath.make(LiUSDBrand, 1200n) }
    },
    { USD: usdMint.mintPayment(usd(1200n)) }
  );
  const addUSDResult = await addCollateralSeat.getOfferResult();

  t.deepEqual(seatOneResult.getStore().get('USD').value, 1200n);
  t.deepEqual(store.get('USD'), AmountMath.make(usdBrand, 1200n));

  t.deepEqual(seatOneResult.getStore().get('Osmos').value, 1000n);
  t.deepEqual(store.get('Osmos').value, 1000n);

  const addCollateralToSeatTwo = await E(zoe).offer(
    E(seatTwoResult).addCollateralInvitation(),
    {
      give: { Osmos: osmo(1200n) },
      want: { LiOsmos: AmountMath.make(LiOsmoBrand, 1200n) }
    },
    { Osmos: osmoMint.mintPayment(osmo(1200n)) }
  );
  const addCollateralToSeatTwoPayment = await addCollateralToSeatTwo.getPayout(
    'LiOsmos'
  );
  const addCollateralToSeatTwoPaymentValue = await E(LiOsmoIssuer).getAmountOf(
    addCollateralToSeatTwoPayment
  );
  const seatOneAddAtom = await E(zoe).offer(
    E(seatOneResult).addCollateralInvitation(),
    {
      give: { Atoms: atoms(1000n) },
      want: { LiAtoms: AmountMath.make(LiAtomsBrand, 1000n) }
    },
    { Atoms: atomMint.mintPayment(atoms(1000n)) }
  );
  t.deepEqual(addCollateralToSeatTwoPaymentValue, LiOsmoAmount(1200n));

  // borrow
  const borrowFromSeatOne = await E(zoe).offer(
    E(seatOneResult).borrowInvitation(),
    {
      want: { USD: AmountMath.make(usdBrand, 200n) }
    }
  );

  const borrowResult = await E(borrowFromSeatOne).getOfferResult();
  console.log({ borrowResult });
  t.deepEqual(!borrowResult.error === true, true);

  // borrow
  const borrowFromSeatTwo = await E(zoe).offer(
    E(seatTwoResult).borrowInvitation(),
    {
      want: { USD: AmountMath.make(usdBrand, 22200n) }
    }
  );

  const borrowResultTwo = await E(borrowFromSeatTwo).getOfferResult();
  t.deepEqual(!borrowResultTwo.error === false, true);
});
