/**
 *
 * This object is returned from the smart contract following the execution of successful offerHandler funciton.
 *
 * It contains invitations which the account holder can use for further interaction with a lending pool.
 *
 * In addition to offer invitations, the AccountOfferResult also returns a reference to an account's AccountStore key-value pair, which can be used to view information about their balances.
 *
 * @typedef {object} AccountOfferResult
 * @property {() => Promise<AccountStore>} getStore AccountStore key-value pair, which can be used to view information about their balances.
 * @property {() => Promise<Invitation>} borrowInvitation Invitation for initiating a borrow offer against an account's deposits.
 * @property {() => Promise<Invitation>} addCollateralInvitation Invitation for adding additional collateral to the lending pool.
 */

/**
 * Provides information about an account's balance for a specific token issuer.
 * When an account makes an offer using this issues, the details will be used to update the balance with their account store.
 *
 * @typedef {object} Balance
 * @property {Brand} brand Brand of the tokens deposit
 * @property {MaxAllowed} maxAllowed information about maximum LTV values
 * @property {Ratio} maxLtv the maximum LTV value for a specific brand.
 * @property {bigint} value The sum of all deposits that an account has made for a particular issuer.
 */

/**
 * Provides information about an account's balance for all markets that it has interacted with.
 *
 * Each time an acccount interacts a lending market, information about the transaction is recorded using the AccountStore, which can then be viewed by the account's holder.
 * When the contract execution finishes, the holder can view the updated values reflected within their AccountStore.
 *
 * @typedef {MapStore<'Keyword', Balance>} AccountStore
 */

/**
 * @typedef {object} MaxAllowed This object represents how much an account can borrow against the collateral they have supplied to specific market.
 * MaxAllowed uses calculates the total supply in USD and uses the LTV for a market to arrive at the MaxAllowed value.
 * When executing a borrow offer, the contract will take the combine the MaxAllowed value from each market and verify it against the requested amount.
 * @property {Brand} brand denomination brand which the value is calculated.
 * @property {bigint} value integer representation of the maximum value an account can borrow.
 */

/**
 * @typedef {Function} MakeAccountOfferHandler
 * @param {(AccountStore)} store
 * @returns {(seat: OfferHandler) => AccountOfferResult} offerResult
 */
