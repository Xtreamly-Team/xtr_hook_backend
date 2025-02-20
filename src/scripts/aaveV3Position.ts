import { createPublicClient, http, PublicClient } from 'viem';
import { arbitrum } from 'viem/chains';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

// Constants
const AAVE_V3_POOL_ADDRESS = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'; // Aave V3 Pool on Arbitrum
const UI_POOL_DATA_PROVIDER_ADDRESS =
	'0x7f23d86ee20d869112572136221e173428dd740b';

const USDC_ADDRESS = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';

const RPC_URL = process.env.ARBITRUM_RPC!;

const AAVE_V3_ABI = [
	{
		inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
		name: 'getUserAccountData',
		outputs: [
			{ internalType: 'uint256', name: 'totalCollateralBase', type: 'uint256' },
			{ internalType: 'uint256', name: 'totalDebtBase', type: 'uint256' },
			{
				internalType: 'uint256',
				name: 'availableBorrowsBase',
				type: 'uint256',
			},
			{
				internalType: 'uint256',
				name: 'currentLiquidationThreshold',
				type: 'uint256',
			},
			{ internalType: 'uint256', name: 'ltv', type: 'uint256' },
			{ internalType: 'uint256', name: 'healthFactor', type: 'uint256' },
		],
		stateMutability: 'view',
		type: 'function',
	},
] as const;

// Types
interface PositionAnalysis {
	currentLTV: number;
	riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
	suggestedActions: string[];
	healthFactor: number;
	collateralValue: number;
	debtValue: number;
}

// Create Viem Public Client
const publicClient = createPublicClient({
	chain: arbitrum,
	transport: http(RPC_URL),
});

async function fetchEthPrice(): Promise<number> {
	try {
		const response = await axios.get(
			'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
		);
		const ethPrice = response.data.ethereum.usd; // Extract the price in USD
		console.log(`The current price of WETH is $${ethPrice}`);
		return ethPrice;
	} catch (error) {
		console.error('Error fetching ETH price from coingecko:', error);
		throw error;
	}
}

export async function getTokenEOABalances(userAddress: string) {
	try {
		const usdcBalance = await publicClient.readContract({
			address: USDC_ADDRESS,
			abi: [{
				inputs: [{ name: 'account', type: 'address' }],
				name: 'balanceOf',
				outputs: [{ name: '', type: 'uint256' }],
				stateMutability: 'view',
				type: 'function'
			}],
			functionName: 'balanceOf',
			args: [userAddress as `0x${string}`]
		});

		const wethBalance = await publicClient.readContract({
			address: WETH_ADDRESS,
			abi: [{
				inputs: [{ name: 'account', type: 'address' }],
				name: 'balanceOf', 
				outputs: [{ name: '', type: 'uint256' }],
				stateMutability: 'view',
				type: 'function'
			}],
			functionName: 'balanceOf',
			args: [userAddress as `0x${string}`]
		});

		return {
			usdc: {
				raw: usdcBalance,
				formatted: Number(usdcBalance) / 1e6,
				displayString: `${Number(usdcBalance) / 1e6} USDC`
			},
			weth: {
				raw: wethBalance,
				formatted: Number(wethBalance) / 1e18,
				displayString: `${Number(wethBalance) / 1e18} WETH`
			}
		};
	} catch (error) {
		console.error('Error fetching token balances:', error);
		throw error;
	}
}

export async function getAaveV3Position(userAddress: string) {
	try {
		const userData = await publicClient.readContract({
			address: AAVE_V3_POOL_ADDRESS,
			abi: AAVE_V3_ABI,
			functionName: 'getUserAccountData',
			args: [userAddress as `0x${string}`],
		});

		return {
			totalCollateralBase: userData[0],
			totalDebtBase: userData[1],
			availableBorrowsBase: userData[2],
			currentLiquidationThreshold: userData[3],
			ltv: userData[4],
			healthFactor: userData[5],
		};
	} catch (error) {
		console.error('Error fetching AAVE V3 position:', error);
		throw error;
	}
}

export async function evaluateAavePosition(
	userAddress: string
): Promise<PositionAnalysis> {
	const position = await getAaveV3Position(userAddress);

	// Calculate current LTV
	const currentLTV = Number(position.ltv) / 10000;

	const healthFactor = Number(position.healthFactor) / 1e18;

	let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
	const suggestedActions: string[] = [];

	if (healthFactor < 1.1) {
		riskLevel = 'HIGH';
		suggestedActions.push('URGENT: Low Health Factor, Position at risk of liquidation');
	} else if (healthFactor < 1.5) {
		riskLevel = 'MEDIUM';
		suggestedActions.push('Position requires needs to be monitored');
	}

	return {
		currentLTV,
		riskLevel,
		suggestedActions,
		healthFactor,
		collateralValue: Number(position.totalCollateralBase) / 1e18,
		debtValue: Number(position.totalDebtBase) / 1e18,
	};
}

export async function getFullAavePositionData(userAddress: string) {
	try {
		// Get overall position analysis
		const positionAnalysis = await evaluateAavePosition(userAddress);
		const ethPrice = await fetchEthPrice();

		// Get USDC reserve data
		const usdcData = await getUserReserveDataForToken(
			userAddress as `0x${string}`,
			USDC_ADDRESS,
			6
		);

		// Get WETH reserve data
		const wethData = await getUserReserveDataForToken(
			userAddress as `0x${string}`,
			WETH_ADDRESS,
			18
		);

		return {
			positionAnalysis,
			usdcData,
			wethData,
		};
	} catch (error) {
		console.error('Error getting full Aave position data:', error);
		throw error;
	}
}

// Test function not relevant for production or prompt generation
async function main() {
	const testAddress = '0xf2873f92324e8ec98a82c47afa0e728bd8e41665';
	try {
		const analysis = await evaluateAavePosition(testAddress);
		console.log('Backend Position Analysis:', JSON.stringify(analysis, null, 2));
		console.log('aave onchain response for user position', await getAaveV3Position(testAddress));
		console.log(
			'USDC data:',
			await getUserReserveDataForToken(testAddress, USDC_ADDRESS, 6)
		);
		console.log(
			'WETH data:',
			await getUserReserveDataForToken(testAddress, WETH_ADDRESS, 18)
		);

		try {
			const ethPrice = await fetchEthPrice();
			console.log(`The current price of WETH is $${ethPrice}`);
		} catch (error) {
			console.error('Error in main function:', error);
		}
	} catch (error) {
		console.error('Error:', error);
	}
}

// Run if called directly
if (require.main === module) {
	main();
}

async function getUserReserveDataForToken(
	userAddress: `0x${string}`,
	tokenAddress: `0x${string}`,
	tokenDecimals: number
) {
	try {
		// Fetch reserve data for the specified token and user
		const reserveData = await publicClient.readContract({
			address: UI_POOL_DATA_PROVIDER_ADDRESS,
			abi: UI_POOL_DATA_PROVIDER_ABI,
			functionName: 'getUserReserveData',
			args: [
				tokenAddress, // The address of the token
				userAddress, // The address of the user
			],
		});

		// Ensure reserveData has the expected structure
		if (!reserveData || reserveData.length < 9) {
			throw new Error('Invalid reserve data returned from contract');
		}
		// console.log('reserveData', reserveData);

		// Format the data for easier consumption
		let tokenDecimalsResponse = `The token has ${tokenDecimals} decimals`;
		const formattedData = {
			tokenAddress,
			tokenDecimalsResponse,
			balances: {
				supplied: Number(reserveData[0]) / 10 ** tokenDecimals, // Current aToken balance
				stableDebt: Number(reserveData[1]) / 10 ** tokenDecimals, // Current stable debt
				variableDebt: Number(reserveData[2]) / 10 ** tokenDecimals, // Current variable debt
			},
			rates: {
				supplyAPY: Number(reserveData[6]) / 1e27, // Supply APY in Ray units
				stableBorrowAPY: Number(reserveData[5]) / 1e27, // Stable borrow APY in Ray units
			},
			collateral: {
				enabled: reserveData[8], // Whether the asset can be used as collateral
			},
		};

		// console.log(JSON.stringify(formattedData, null, 2));

		return formattedData;
	} catch (error) {
		console.error(
			'Error fetching reserve data for token:',
			tokenAddress,
			error
		);
		throw error; // Rethrow the error for further handling
	}
}

// Example usage:

const UI_POOL_DATA_PROVIDER_ABI = [
	{
		type: 'function',
		name: 'getUserReserveData',
		constant: false,
		anonymous: false,
		stateMutability: 'view',
		inputs: [
			{
				name: 'asset',
				type: 'address',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'address' },
			},
			{
				name: 'user',
				type: 'address',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'address' },
			},
		],
		outputs: [
			{
				name: 'currentATokenBalance',
				type: 'uint256',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'uint' },
			},
			{
				name: 'currentStableDebt',
				type: 'uint256',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'uint' },
			},
			{
				name: 'currentVariableDebt',
				type: 'uint256',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'uint' },
			},
			{
				name: 'principalStableDebt',
				type: 'uint256',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'uint' },
			},
			{
				name: 'scaledVariableDebt',
				type: 'uint256',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'uint' },
			},
			{
				name: 'stableBorrowRate',
				type: 'uint256',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'uint' },
			},
			{
				name: 'liquidityRate',
				type: 'uint256',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'uint' },
			},
			{
				name: 'stableRateLastUpdated',
				type: 'uint40',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'uint' },
			},
			{
				name: 'usageAsCollateralEnabled',
				type: 'bool',
				storage_location: 'default',
				offset: 0,
				index:
					'0x0000000000000000000000000000000000000000000000000000000000000000',
				indexed: false,
				simple_type: { type: 'bool' },
			},
		],
	},
	// 	{
	// 		type: 'function',
	// 		name: 'getAllATokens',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple[]',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'symbol',
	// 						type: 'string',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'string' },
	// 					},
	// 					{
	// 						name: 'tokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'slice' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getFlashLoanEnabled',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getIsVirtualAccActive',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveConfigurationData',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'decimals',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'ltv',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidationThreshold',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidationBonus',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'reserveFactor',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'usageAsCollateralEnabled',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 			{
	// 				name: 'borrowingEnabled',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 			{
	// 				name: 'stableBorrowRateEnabled',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 			{
	// 				name: 'isActive',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 			{
	// 				name: 'isFrozen',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveData',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'unbacked',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'accruedToTreasuryScaled',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'totalAToken',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'totalStableDebt',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'totalVariableDebt',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidityRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'variableBorrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'stableBorrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'averageStableBorrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidityIndex',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'variableBorrowIndex',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'lastUpdateTimestamp',
	// 				type: 'uint40',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'ADDRESSES_PROVIDER',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getDebtCeiling',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getDebtCeilingDecimals',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'pure',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPaused',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'isPaused',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getSiloedBorrowing',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getTotalDebt',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getUnbackedMintCap',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getAllReservesTokens',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple[]',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'symbol',
	// 						type: 'string',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'string' },
	// 					},
	// 					{
	// 						name: 'tokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'slice' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getInterestRateStrategyAddress',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'irStrategyAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getLiquidationProtocolFee',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveCaps',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'borrowCap',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'supplyCap',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPreviousIndex',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getScaledUserBalanceAndSupply',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'scaledBalanceOf',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'scaledTotalSupply',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Burn',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'from',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'target',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'value',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'balanceIncrease',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'index',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Mint',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'caller',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'value',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'balanceIncrease',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'index',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'DEBT_CEILING_DECIMALS',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'MAX_RESERVES_COUNT',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getEModeCategoryCollateralConfig',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'ltv',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'liquidationThreshold',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'liquidationBonus',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'updateFlashloanPremiums',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'flashLoanPremiumTotal',
	// 				type: 'uint128',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'flashLoanPremiumToProtocol',
	// 				type: 'uint128',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'withdraw',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'to',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'BRIDGE_PROTOCOL_FEE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPoolLogic',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'repayWithATokens',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'interestRateMode',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'repayWithPermit',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'interestRateMode',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'deadline',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'permitV',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'permitR',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 			{
	// 				name: 'permitS',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'FLASHLOAN_PREMIUM_TOTAL',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint128',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getBridgeLogic',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveNormalizedVariableDebt',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'repay',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'interestRateMode',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReservesCount',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'updateBridgeProtocolFee',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'bridgeProtocolFee',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'backUnbacked',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'fee',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'configureEModeCategory',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'config',
	// 				type: 'tuple',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'ltv',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'liquidationThreshold',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'liquidationBonus',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'label',
	// 						type: 'string',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'string' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getLiquidationGracePeriod',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint40',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveNormalizedIncome',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'ADDRESSES_PROVIDER',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getEModeLogic',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'configureEModeCategoryCollateralBitmap',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'collateralBitmap',
	// 				type: 'uint128',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReservesList',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address[]',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'slice', nested_type: { type: 'address' } },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getSupplyLogic',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'resetIsolationModeTotalDebt',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setUserEMode',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'categoryId',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'flashLoan',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'receiverAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'assets',
	// 				type: 'address[]',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'slice', nested_type: { type: 'address' } },
	// 			},
	// 			{
	// 				name: 'amounts',
	// 				type: 'uint256[]',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'slice', nested_type: { type: 'uint' } },
	// 			},
	// 			{
	// 				name: 'interestRateModes',
	// 				type: 'uint256[]',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'slice', nested_type: { type: 'uint' } },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'params',
	// 				type: 'bytes',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'flashLoanSimple',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'receiverAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'params',
	// 				type: 'bytes',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getEModeCategoryLabel',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveAddressById',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getVirtualUnderlyingBalance',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint128',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setLiquidationGracePeriod',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'until',
	// 				type: 'uint40',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setReserveInterestRateStrategyAddress',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'rateStrategyAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'configureEModeCategoryBorrowableBitmap',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'borrowableBitmap',
	// 				type: 'uint128',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'deposit',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'finalizeTransfer',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'from',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'to',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'balanceFromBefore',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'balanceToBefore',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getEModeCategoryCollateralBitmap',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint128',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getFlashLoanLogic',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'liquidationCall',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'collateralAsset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'debtAsset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'debtToCover',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'receiveAToken',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getUserAccountData',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'totalCollateralBase',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'totalDebtBase',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'availableBorrowsBase',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'currentLiquidationThreshold',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'ltv',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'healthFactor',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'initReserve',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'aTokenAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'variableDebtAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'interestRateStrategyAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'rescueTokens',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'token',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'to',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'supply',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getEModeCategoryBorrowableBitmap',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint128',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getLiquidationLogic',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getUserConfiguration',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'data',
	// 						type: 'uint256',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'mintToTreasury',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'assets',
	// 				type: 'address[]',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'slice', nested_type: { type: 'address' } },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'FLASHLOAN_PREMIUM_TO_PROTOCOL',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint128',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveData',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'configuration',
	// 						type: 'tuple',
	// 						storage_location: 'default',
	// 						components: [
	// 							{
	// 								name: 'data',
	// 								type: 'uint256',
	// 								storage_location: 'default',
	// 								offset: 0,
	// 								index:
	// 									'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 								indexed: false,
	// 								simple_type: { type: 'uint' },
	// 							},
	// 						],
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 					},
	// 					{
	// 						name: 'liquidityIndex',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'currentLiquidityRate',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'variableBorrowIndex',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'currentVariableBorrowRate',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'currentStableBorrowRate',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'lastUpdateTimestamp',
	// 						type: 'uint40',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'id',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'aTokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 					{
	// 						name: 'stableDebtTokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 					{
	// 						name: 'variableDebtTokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 					{
	// 						name: 'interestRateStrategyAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 					{
	// 						name: 'accruedToTreasury',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'unbacked',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'isolationModeTotalDebt',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setConfiguration',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'configuration',
	// 				type: 'tuple',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'data',
	// 						type: 'uint256',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'syncRatesState',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'MAX_NUMBER_RESERVES',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'dropReserve',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getEModeCategoryData',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'ltv',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'liquidationThreshold',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'liquidationBonus',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'priceSource',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 					{
	// 						name: 'label',
	// 						type: 'string',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'string' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'mintUnbacked',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getBorrowLogic',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'borrow',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'interestRateMode',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getConfiguration',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'data',
	// 						type: 'uint256',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveDataExtended',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'configuration',
	// 						type: 'tuple',
	// 						storage_location: 'default',
	// 						components: [
	// 							{
	// 								name: 'data',
	// 								type: 'uint256',
	// 								storage_location: 'default',
	// 								offset: 0,
	// 								index:
	// 									'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 								indexed: false,
	// 								simple_type: { type: 'uint' },
	// 							},
	// 						],
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 					},
	// 					{
	// 						name: 'liquidityIndex',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'currentLiquidityRate',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'variableBorrowIndex',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'currentVariableBorrowRate',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: '__deprecatedStableBorrowRate',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'lastUpdateTimestamp',
	// 						type: 'uint40',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'id',
	// 						type: 'uint16',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'liquidationGracePeriodUntil',
	// 						type: 'uint40',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'aTokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 					{
	// 						name: '__deprecatedStableDebtTokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 					{
	// 						name: 'variableDebtTokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 					{
	// 						name: 'interestRateStrategyAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 					{
	// 						name: 'accruedToTreasury',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'unbacked',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'isolationModeTotalDebt',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 					{
	// 						name: 'virtualUnderlyingBalance',
	// 						type: 'uint128',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'uint' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'supplyWithPermit',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'deadline',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'permitV',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'permitR',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 			{
	// 				name: 'permitS',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getUserEMode',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setUserUseReserveAsCollateral',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'useAsCollateral',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'syncIndexesState',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'ReserveDataUpdated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'liquidityRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'stableBorrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'variableBorrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidityIndex',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'variableBorrowIndex',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Supply',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'BackUnbacked',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'backer',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'fee',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Repay',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'repayer',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'useATokens',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'ReserveUsedAsCollateralDisabled',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Withdraw',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'to',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'LiquidationCall',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'collateralAsset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'debtAsset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'debtToCover',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidatedCollateralAmount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidator',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'receiveAToken',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'MintUnbacked',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'ReserveUsedAsCollateralEnabled',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'UserEModeSet',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'categoryId',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Borrow',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'interestRateMode',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'borrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'IsolationModeTotalDebtUpdated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'totalDebt',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'FlashLoan',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'target',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'initiator',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'interestRateMode',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'premium',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'referralCode',
	// 				type: 'uint16',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'MintedToTreasury',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'reserve',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amountMinted',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getScaledUserBalanceAndSupply',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'initialize',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'pool',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'underlyingAsset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'incentivesController',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'debtTokenDecimals',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'debtTokenName',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 			{
	// 				name: 'debtTokenSymbol',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 			{
	// 				name: 'params',
	// 				type: 'bytes',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'mint',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'index',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'scaledBalanceOf',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'scaledTotalSupply',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'UNDERLYING_ASSET_ADDRESS',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'burn',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'from',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'index',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPreviousIndex',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Mint',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'caller',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'onBehalfOf',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'value',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'balanceIncrease',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'index',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Burn',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'from',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'target',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'value',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'balanceIncrease',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'index',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Initialized',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'underlyingAsset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'pool',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'incentivesController',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'debtTokenDecimals',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'debtTokenName',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 			{
	// 				name: 'debtTokenSymbol',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 			{
	// 				name: 'params',
	// 				type: 'bytes',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getIsVirtualAccActive',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveConfigurationData',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'decimals',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'ltv',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidationThreshold',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidationBonus',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'reserveFactor',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'usageAsCollateralEnabled',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 			{
	// 				name: 'borrowingEnabled',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 			{
	// 				name: 'stableBorrowRateEnabled',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 			{
	// 				name: 'isActive',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 			{
	// 				name: 'isFrozen',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getSiloedBorrowing',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'ADDRESSES_PROVIDER',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getAllATokens',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple[]',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'symbol',
	// 						type: 'string',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'string' },
	// 					},
	// 					{
	// 						name: 'tokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'slice' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getDebtCeilingDecimals',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'pure',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getUserReserveData',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'currentATokenBalance',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'currentStableDebt',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'currentVariableDebt',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'principalStableDebt',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'scaledVariableDebt',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'stableBorrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidityRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'stableRateLastUpdated',
	// 				type: 'uint40',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'usageAsCollateralEnabled',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getLiquidationProtocolFee',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPaused',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'isPaused',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveData',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'unbacked',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'accruedToTreasuryScaled',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'totalAToken',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'totalStableDebt',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'totalVariableDebt',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidityRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'variableBorrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'stableBorrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'averageStableBorrowRate',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'liquidityIndex',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'variableBorrowIndex',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'lastUpdateTimestamp',
	// 				type: 'uint40',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveCaps',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'borrowCap',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'supplyCap',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getReserveTokensAddresses',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'aTokenAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'stableDebtTokenAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'variableDebtTokenAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getTotalDebt',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getATokenTotalSupply',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getAllReservesTokens',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'tuple[]',
	// 				storage_location: 'default',
	// 				components: [
	// 					{
	// 						name: 'symbol',
	// 						type: 'string',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'string' },
	// 					},
	// 					{
	// 						name: 'tokenAddress',
	// 						type: 'address',
	// 						storage_location: 'default',
	// 						offset: 0,
	// 						index:
	// 							'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 						indexed: false,
	// 						simple_type: { type: 'address' },
	// 					},
	// 				],
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'slice' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getInterestRateStrategyAddress',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: 'irStrategyAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getVirtualUnderlyingBalance',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getDebtCeiling',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getFlashLoanEnabled',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getUnbackedMintCap',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'asset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'ASSET_NOT_BORROWABLE_IN_ISOLATION',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_NOT_RISK_OR_POOL_OR_EMERGENCY_ADMIN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_MINT_AMOUNT',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_SIGNATURE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'RESERVE_FROZEN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'SUPPLY_CAP_EXCEEDED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'UNDERLYING_CLAIMABLE_RIGHTS_NOT_ZERO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'ACL_ADMIN_CANNOT_BE_ZERO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INTEREST_RATE_REBALANCE_CONDITIONS_NOT_MET',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_ADDRESSES_PROVIDER_ID',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_AMOUNT',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_DEBT_CEILING',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_EXPIRATION',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'RESERVE_ALREADY_INITIALIZED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'RESERVE_LIQUIDITY_NOT_ZERO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_NOT_BRIDGE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'UNDERLYING_CANNOT_BE_RESCUED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'WITHDRAW_TO_ATOKEN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'UNBACKED_MINT_CAP_EXCEEDED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_BURN_AMOUNT',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_LIQ_BONUS',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_LIQ_THRESHOLD',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_NOT_EMERGENCY_ADMIN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'FLASHLOAN_DISABLED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_FREEZE_STATE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_LIQUIDATION_PROTOCOL_FEE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_RESERVE_FACTOR',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_RESERVE_INDEX',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'RESERVE_INACTIVE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'EMODE_CATEGORY_RESERVED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_NOT_POOL_CONFIGURATOR',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'DEBT_CEILING_NOT_ZERO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'NOT_CONTRACT',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'NO_EXPLICIT_AMOUNT_TO_REPAY_ON_BEHALF',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'USER_IN_ISOLATION_MODE_OR_LTV_ZERO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_BORROW_CAP',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_MAX_RATE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_RESERVE_PARAMS',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'SLOPE_2_MUST_BE_GTE_SLOPE_1',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'BORROW_CAP_EXCEEDED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'BRIDGE_PROTOCOL_FEE_INVALID',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'COLLATERAL_CANNOT_BE_LIQUIDATED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'HEALTH_FACTOR_NOT_BELOW_THRESHOLD',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_DECIMALS',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'NOT_ENOUGH_AVAILABLE_USER_BALANCE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'ASSET_NOT_LISTED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'COLLATERAL_BALANCE_IS_ZERO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_FLASHLOAN_EXECUTOR_RETURN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_LTV',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'RESERVE_ALREADY_ADDED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'ADDRESSES_PROVIDER_NOT_REGISTERED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'COLLATERAL_CANNOT_COVER_NEW_BORROW',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'FLASHLOAN_PREMIUM_INVALID',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_UNBACKED_MINT_CAP',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'UNDERLYING_BALANCE_ZERO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_NOT_ATOKEN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INCONSISTENT_FLASHLOAN_PARAMS',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_GRACE_PERIOD',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_OPTIMAL_USAGE_RATIO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'SILOED_BORROWING_VIOLATION',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'ADDRESSES_PROVIDER_ALREADY_ADDED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_NOT_RISK_OR_POOL_ADMIN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'COLLATERAL_SAME_AS_BORROWING_CURRENCY',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_EMODE_CATEGORY',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_EMODE_CATEGORY_PARAMS',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'NOT_BORROWABLE_IN_EMODE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'PRICE_ORACLE_SENTINEL_CHECK_FAILED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'RESERVE_PAUSED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_MUST_BE_POOL',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_SUPPLY_CAP',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'NO_OUTSTANDING_VARIABLE_DEBT',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'SUPPLY_TO_ATOKEN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'ZERO_ADDRESS_NOT_VALID',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'DEBT_CEILING_EXCEEDED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_ADDRESSES_PROVIDER',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'LIQUIDATION_GRACE_SENTINEL_CHECK_FAILED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'LTV_VALIDATION_FAILED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'NO_DEBT_OF_SELECTED_TYPE',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INCONSISTENT_EMODE_CATEGORY',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_NOT_POOL_OR_EMERGENCY_ADMIN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_EMODE_CATEGORY_ASSIGNMENT',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INVALID_INTEREST_RATE_MODE_SELECTED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'POOL_ADDRESSES_DO_NOT_MATCH',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'RESERVE_DEBT_NOT_ZERO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'BORROWING_NOT_ENABLED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'INCONSISTENT_PARAMS_LENGTH',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'NO_MORE_RESERVES_ALLOWED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'OPERATION_NOT_SUPPORTED',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'VARIABLE_DEBT_SUPPLY_NOT_ZERO',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'CALLER_NOT_POOL_ADMIN',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'initialize',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'pool',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'underlyingAsset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'incentivesController',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'debtTokenDecimals',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'debtTokenName',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 			{
	// 				name: 'debtTokenSymbol',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 			{
	// 				name: 'params',
	// 				type: 'bytes',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Initialized',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'underlyingAsset',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'pool',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'incentivesController',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'debtTokenDecimals',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'debtTokenName',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 			{
	// 				name: 'debtTokenSymbol',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 			{
	// 				name: 'params',
	// 				type: 'bytes',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'transfer',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'recipient',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'transferFrom',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'sender',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'recipient',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'allowance',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'owner',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'spender',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'approve',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'spender',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'balanceOf',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'account',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'totalSupply',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Approval',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'owner',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'spender',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'value',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Transfer',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'from',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'to',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'value',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'handleAction',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'user',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'totalSupply',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 			{
	// 				name: 'userBalance',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'allowance',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'owner',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'spender',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'balanceOf',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'account',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'symbol',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'transfer',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'recipient',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'approve',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'spender',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'decimals',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint8',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'name',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'totalSupply',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'transferFrom',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'sender',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'recipient',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'amount',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'bool',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bool' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Approval',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'owner',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'spender',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'value',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'Transfer',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'from',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'to',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'value',
	// 				type: 'uint256',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'uint' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// ],
	// [
	// 	{
	// 		type: 'constructor',
	// 		name: '',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: null,
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setAddress',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 			{
	// 				name: 'newAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setPriceOracle',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'newPriceOracle',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getAddress',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 		],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getACLManager',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getMarketId',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setACLAdmin',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'newAclAdmin',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setPoolConfiguratorImpl',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'newPoolConfiguratorImpl',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getACLAdmin',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setAddressAsProxy',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 			{
	// 				name: 'newImplementationAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setPoolDataProvider',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'newDataProvider',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPool',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPoolDataProvider',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPriceOracle',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPriceOracleSentinel',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setACLManager',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'newAclManager',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setMarketId',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'newMarketId',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setPoolImpl',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'newPoolImpl',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'setPriceOracleSentinel',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'nonpayable',
	// 		inputs: [
	// 			{
	// 				name: 'newPriceOracleSentinel',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: [],
	// 	},
	// 	{
	// 		type: 'function',
	// 		name: 'getPoolConfigurator',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: 'view',
	// 		inputs: [],
	// 		outputs: [
	// 			{
	// 				name: '',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'AddressSet',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 			{
	// 				name: 'oldAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'newAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'AddressSetAsProxy',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 			{
	// 				name: 'proxyAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'oldImplementationAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: false,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'newImplementationAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'MarketIdSet',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'oldMarketId',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'string' },
	// 			},
	// 			{
	// 				name: 'newMarketId',
	// 				type: 'string',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'string' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'ProxyCreated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'id',
	// 				type: 'bytes32',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'bytes' },
	// 			},
	// 			{
	// 				name: 'proxyAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'implementationAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'ACLAdminUpdated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'oldAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'newAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'PoolConfiguratorUpdated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'oldAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'newAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'PoolDataProviderUpdated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'oldAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'newAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'PoolUpdated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'oldAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'newAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'PriceOracleSentinelUpdated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'oldAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'newAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'PriceOracleUpdated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'oldAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'newAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
	// 	{
	// 		type: 'event',
	// 		name: 'ACLManagerUpdated',
	// 		constant: false,
	// 		anonymous: false,
	// 		stateMutability: '',
	// 		inputs: [
	// 			{
	// 				name: 'oldAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 			{
	// 				name: 'newAddress',
	// 				type: 'address',
	// 				storage_location: 'default',
	// 				offset: 0,
	// 				index:
	// 					'0x0000000000000000000000000000000000000000000000000000000000000000',
	// 				indexed: true,
	// 				simple_type: { type: 'address' },
	// 			},
	// 		],
	// 		outputs: null,
	// 	},
] as const;
