// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { test } from './prepare-test-env-ava.js';
import path from 'path';

import bundleSource from '@endo/bundle-source';

import { E } from '@endo/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/tools/fakeVatAdmin.js';
import { makeZoeKit } from '@agoric/zoe';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';
import { makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';

const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);

const contractPath = `${dirname}/../src/alternative-contract.js`;
const { brand, issuer: dollarIssuer, mint } = makeIssuerKit('dollars');
const dollars = x => AmountMath.make(brand, x);
const {
  brand: atomBrand,
  issuer: atomIssuer,
  mint: atomMint
} = makeIssuerKit('atom');
const atoms = x => AmountMath.make(atomBrand, x);

test('zoe - mint payments', async t => {
  const { zoeService } = makeZoeKit(makeFakeVatAdmin().admin);
  const feePurse = E(zoeService).makeFeePurse();
  const zoe = E(zoeService).bindDefaultFeePurse(feePurse);

  // pack the contract
  const bundle = await bundleSource(contractPath);

  // install the contract
  const installation = E(zoe).install(bundle);

  const dollarsToAtomsRatio = makeRatio(10n, atomBrand, 1n, brand);
  const { creatorFacet, instance } = await E(zoe).startInstance(
    installation,
    {
      Dollars: dollarIssuer,
      Atoms: atomIssuer
    },
    {
      dollarsToAtomsRatio
    }
  );
  // Let's get the tokenIssuer from the contract so we can evaluate
  // what we get as our payout
  const publicFacet = E(zoe).getPublicFacet(instance);
  const tokenIssuer = E(publicFacet).getTokenIssuer();
  const tokenBrand = await E(tokenIssuer).getBrand();
  // Alice makes an invitation for Bob that will give him 1000 tokens
  const invitation = E(creatorFacet).makeInvitation();

  // Bob makes an offer using the invitation
  const seat = await E(zoe).offer(
    invitation,
    {
      give: { Dollars: dollars(100n) },
      want: { Token: AmountMath.make(tokenBrand, 100n) }
    },
    { Dollars: mint.mintPayment(dollars(100n)) }
  );

  t.deepEqual(await seat.hasExited(), true);

  const result = await seat.getOfferResult();
  t.truthy(
    result.getStore,
    'openAccount should return a reference to getStore'
  );
  t.truthy(
    result.addCollateralInvitation,
    'openAccount should return a reference to addCollateral'
  );

  // Let's get the tokenIssuer from the contract so we can evaluate
  // what we get as our payout

  const tokens = x => AmountMath.make(tokenBrand, x);
  const paymentP = await seat.getPayout('Token');
  const tokenPayoutAmount = await E(tokenIssuer).getAmountOf(paymentP);

  t.deepEqual(tokenPayoutAmount, tokens(100n));

  const store = await E(creatorFacet).getStore();
  // t.deepEqual(store.get('Dollars'), { brand, value: 100n });

  // Bob makes an offer using the invitation
  const seatTwo = await E(zoe).offer(
    E(creatorFacet).makeInvitation(),
    {
      give: { Dollars: dollars(200n) },
      want: { Token: AmountMath.make(tokenBrand, 200n) }
    },
    { Dollars: mint.mintPayment(dollars(200n)) }
  );
  const seatTwoPayout = await seatTwo.getPayout('Token');
  const tokenPayoutAmounTwo = await E(tokenIssuer).getAmountOf(seatTwoPayout);
  const resultTwo = await seatTwo.getOfferResult();

  t.deepEqual(tokenPayoutAmounTwo, tokens(200n));
  t.deepEqual(store.get('Dollars'), { value: 300n, brand });

  const addCollateralSeat = await E(zoe).offer(
    E(result).addCollateralInvitation(),
    {
      give: { Dollars: dollars(1200n) },
      want: { Token: AmountMath.make(tokenBrand, 1200n) }
    },
    { Dollars: mint.mintPayment(dollars(1200n)) }
  );
  const addResult = await addCollateralSeat.getOfferResult();

  t.deepEqual(store.get('Dollars'), { value: 1500n, brand });
});
