// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { test } from './prepare-test-env-ava.js';
import path from 'path';

import bundleSource from '@endo/bundle-source';

import { E } from '@endo/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/tools/fakeVatAdmin.js';
import { makeZoeKit } from '@agoric/zoe';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';

const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);

const contractPath = `${dirname}/../src/contract.js`;
const { brand, issuer: dollarIssuer, mint } = makeIssuerKit('dollars');
const dollars = (x) => AmountMath.make(brand, x);

test('zoe - mint payments', async (t) => {
  const { zoeService } = makeZoeKit(makeFakeVatAdmin().admin);
  const feePurse = E(zoeService).makeFeePurse();
  const zoe = E(zoeService).bindDefaultFeePurse(feePurse);

  // pack the contract
  const bundle = await bundleSource(contractPath);

  // install the contract
  const installation = E(zoe).install(bundle);

  const { creatorFacet, instance } = await E(zoe).startInstance(installation, {
    Dollars: dollarIssuer,
  });
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
      want: { Token: AmountMath.make(tokenBrand, 100n) },
    },
    { Dollars: mint.mintPayment(dollars(100n)) },
  );

  t.deepEqual(await seat.hasExited(), true);
  t.deepEqual(
    await seat.getOfferResult(),
    'Offer completed. You should receive a payment from Zoe',
  );

  const result = await seat.getOfferResult();
  t.deepEqual(
    result,
    'Offer completed. You should receive a payment from Zoe',
    'should return the correct string',
  );
  // Let's get the tokenIssuer from the contract so we can evaluate
  // what we get as our payout

  const tokens100 = AmountMath.make(tokenBrand, 100n);
  const paymentP = await seat.getPayout('Token');
  const tokenPayoutAmount = await E(tokenIssuer).getAmountOf(paymentP);

  t.deepEqual(tokenPayoutAmount, tokens100);
});
