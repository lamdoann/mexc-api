export interface AccountBalance {
  asset: string;
  free: string;
  locked: string;
}

/** Account type for universal transfers. */
export type TransferAccountType = 'SPOT' | 'FUTURES';

export interface UniversalTransferRequest {
  fromAccountType: TransferAccountType;
  toAccountType: TransferAccountType;
  asset: string;
  amount: string | number;
}

/** Response of POST /api/v3/capital/transfer (signed). */
export interface UniversalTransferResult {
  tranId: string;
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
