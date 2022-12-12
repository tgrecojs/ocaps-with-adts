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
  makeRatio,
  multiplyBy
} from '@agoric/zoe/src/contractSupport/ratio.js';

const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);

const contractPath = `${dirname}/../src/openAccount.js`;
const { brand, issuer: dollarIssuer, mint } = makeIssuerKit('dollars');
const {
  brand: atomBrand,
  issuer: atomIssuer,
  mint: atomMint
} = makeIssuerKit('atom');
const atoms = x => AmountMath.make(atomBrand, x);
const dollars = x => AmountMath.make(brand, x);

test('zoe - mint payments', async t => {
  const { zoeService } = makeZoeKit(makeFakeVatAdmin().admin);
  const feePurse = E(zoeService).makeFeePurse();
  const zoe = E(zoeService).bindDefaultFeePurse(feePurse);

  // pack the contract
  const bundle = await bundleSource(contractPath);
  const ratio = makeRatio(10n, atomBrand, 1n, brand);

  // install the contract
  const installation = E(zoe).install(bundle);

  const { creatorFacet, instance } = await E(zoe).startInstance(
    installation,
    {
      Dollars: dollarIssuer,
      Atoms: atomIssuer
    },
    {
      dollarsToAtomRatio: ratio
    }
  );
  // Let's get the tokenIssuer from the contract so we can evaluate
  // what we get as our payout
  const publicFacet = E(zoe).getPublicFacet(instance);
  const tokenIssuer = E(publicFacet).getTokenIssuer();
  const tokenBrand = await E(tokenIssuer).getBrand();
  // Alice makes an invitation for Bob that will give him 1000 tokens
  const invitation = E(creatorFacet).makeInvitation();
  const store = await E(creatorFacet).getStore();
  const firstDollarValue = 100n;

  // Bob makes an offer using the invitation
  const seat = await E(zoe).offer(
    invitation,
    {
      give: { Dollars: dollars(firstDollarValue) },
      want: { LiDollars: AmountMath.make(tokenBrand, 100n) }
    },
    { Dollars: mint.mintPayment(dollars(firstDollarValue)) }
  );

  t.deepEqual(await seat.hasExited(), true);

  const seatOneResult = await seat.getOfferResult();
  const userStore = seatOneResult.getStore();
  t.truthy(
    seatOneResult.getStore,
    'openAccount should return a reference to getStore'
  );
  t.truthy(
    seatOneResult.addCollateralInvitation,
    'openAccount should return a reference to addCollateral'
  );

  t.deepEqual(store.get('Dollars'), dollars(firstDollarValue));
  // Let's get the tokenIssuer from the contract so we can evaluate
  // what we get as our payout

  const tokens = x => AmountMath.make(tokenBrand, x);
  const paymentP = await seat.getPayout('LiDollars');
  const tokenPayoutAmount = await E(tokenIssuer).getAmountOf(paymentP);

  t.deepEqual(tokenPayoutAmount, tokens(100n));

  // t.deepEqual(store.get('Dollars'), { brand, value: 100n });

  t.deepEqual(store.get('Dollars'), { value: 100n, brand });
  const secondDollarValue = 1200n;
  const addCollateralSeat = await E(zoe).offer(
    E(seatOneResult).addCollateralInvitation(),
    {
      give: { Dollars: dollars(secondDollarValue) },
      want: { LiDollars: AmountMath.make(tokenBrand, secondDollarValue) }
    },
    { Dollars: mint.mintPayment(dollars(secondDollarValue)) }
  );
  const addResult = await addCollateralSeat.getOfferResult();

  const addCAtomollateralSeat = await E(zoe).offer(
    E(seatOneResult).addCollateralInvitation(),
    {
      give: { Atoms: atoms(1250n) },
      want: { LiAtoms: AmountMath.make(tokenBrand, 1250n) }
    },
    { Atoms: atomMint.mintPayment(atoms(1250n)) }
  );
  const addResultAtom = await addCAtomollateralSeat.getOfferResult();
  console.log({ addResultAtom });

  t.deepEqual(userStore.get('LiDollars').value, 1300n);

  t.deepEqual(store.get('Atoms'), atoms(1250n));
  t.deepEqual([...store.keys()], ['Atoms', 'Dollars']);

  t.deepEqual(multiplyBy(dollars(100n), ratio), atoms(1000n));
  const thirdDollarValue = 200n;

  // Bob makes an offer using the invitation
  const seatTwo = await E(zoe).offer(
    E(creatorFacet).makeInvitation(),
    {
      give: { Dollars: dollars(thirdDollarValue) },
      want: { LiDollars: AmountMath.make(tokenBrand, thirdDollarValue) }
    },
    { Dollars: mint.mintPayment(dollars(thirdDollarValue)) }
  );
  const seatTwoPayout = await seatTwo.getPayout('LiDollars');
  const tokenPayoutAmounTwo = await E(tokenIssuer).getAmountOf(seatTwoPayout);
  const resultTwo = await seatTwo.getOfferResult();

  t.deepEqual(tokenPayoutAmounTwo, tokens(200n));
  t.deepEqual(
    store.get('Dollars'),
    dollars(firstDollarValue + secondDollarValue + thirdDollarValue)
  );
});
