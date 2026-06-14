export interface AccountBalance {
  asset: string;
  free: string;
  locked: string;
}

/** Response of GET /api/v3/account (signed). */
export interface AccountInformation {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number | null;
  accountType: string;
  balances: AccountBalance[];
  permissions: string[];
}
