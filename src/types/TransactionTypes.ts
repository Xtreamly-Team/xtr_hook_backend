export type OnChainAction =
	| 'supply_usdc'
	| 'withdraw_usdc'
	| 'borrow_usdc'
	| 'repay_usdc'
	| 'deposit_eth'
	| 'withdraw_eth'
	| 'repay'
	| 'getBalance';

// Define parameter interfaces for each action
export interface SupplyParams {
	amount: string; // Representing BigInt as a string
	// Add other relevant fields if necessary
}

export interface WithdrawParams {
	amount: string;
	// Add other relevant fields if necessary
}
export interface BorrowParams {
	amount: string;
	// Add other relevant fields if necessary
}

export interface RepayParams {
	amount: string;
	// Add other relevant fields if necessary
}

export interface GetBalanceParams {
	amount: string;
	// Typically, getBalance might require an account address or similar identifier
	// account: string;
}

// Discriminated union for TransactionParams
export type TransactionParams =
	| { action: 'supply_usdc'; params: SupplyParams }
	| { action: 'withdraw_usdc'; params: WithdrawParams }
	| { action: 'borrow_usdc'; params: WithdrawParams }
	| { action: 'repay_usdc'; params: RepayParams }
	| { action: 'deposit_eth'; params: SupplyParams }
	| { action: 'withdraw_eth'; params: WithdrawParams }
	| { action: 'repay'; params: RepayParams }
	| { action: 'getBalance'; params: GetBalanceParams };
