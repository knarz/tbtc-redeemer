import fs from 'fs';
import ethers from 'ethers';

import TBTCSystem from "@keep-network/tbtc/artifacts/TBTCSystem.json";
import VendingMachine from "@keep-network/tbtc/artifacts/VendingMachine.json";
import TBTCToken from "@keep-network/tbtc/artifacts/TBTCToken.json";
import TBTCDepositToken from "@keep-network/tbtc/artifacts/TBTCDepositToken.json";
import Deposit from "@keep-network/tbtc/artifacts/Deposit.json";
import BondedECDSAKeep from "@keep-network/keep-ecdsa/artifacts/BondedECDSAKeep.json";
import DepositLog from "@keep-network/tbtc/artifacts/DepositLog.json";

if (process.argv.length < 3 || !process.argv[2]) {
	console.error('node access.js [password]');
	process.exit(1);
}

const states = [
	// DOES NOT EXIST YET
	"START",

	// FUNDING FLOW
	"AWAITING_SIGNER_SETUP",
	"AWAITING_BTC_FUNDING_PROOF",

	// FAILED SETUP
	"FAILED_SETUP",

	// ACTIVE
	"ACTIVE",  // includes courtesy call

	// REDEMPTION FLOW
	"AWAITING_WITHDRAWAL_SIGNATURE",
	"AWAITING_WITHDRAWAL_PROOF",
	"REDEEMED",

	// SIGNER LIQUIDATION FLOW
	"COURTESY_CALL",
	"FRAUD_LIQUIDATION_IN_PROGRESS",
	"LIQUIDATION_IN_PROGRESS",
	"LIQUIDATED"
];

async function main() {
	let wallet
	try {
		const j = fs.readFileSync('wallet.json', 'utf8');
		const w  = await new ethers.Wallet.fromEncryptedJson(j, process.argv[2]);
		const ip = new ethers.providers.InfuraProvider('ropsten', process.env.INFURA_API);
		wallet = w.connect(ip);

		const vendingContract = new ethers.Contract(VendingMachine.networks["3"].address, VendingMachine.abi, wallet);
		const tokenContract = new ethers.Contract(TBTCToken.networks["3"].address, TBTCToken.abi, wallet);
		const tdtContract = new ethers.Contract(TBTCDepositToken.networks["3"].address, TBTCDepositToken.abi, wallet);

		console.log(`I own ${ethers.utils.formatEther((await tokenContract.balanceOf(wallet.address)).toString())} tBTC`);
		//console.log(tdtContract);

		const transfers = await tdtContract.queryFilter(tdtContract.filters.Transfer(null, wallet.address));
		const tokenIDs = transfers.map(t => { return t.args[2].toHexString()});
		console.log(tokenIDs);

		const activeTDTs = new Array();
		for (let tokenID of tokenIDs) {
			const d = new ethers.Contract(tokenID, Deposit.abi, wallet);
			const depositState = await d.currentState();
			console.log(`[${tokenID}] in state ${states[depositState]} @ ${ethers.utils.formatEther((await d.lotSizeTbtc()).toString())} tBTC`);
			if (depositState.toNumber() === 1) { // Check if we can dissolve this.
				try {
					console.log(`try to call notifySignerSetupFailure`);
					const tx = await d.notifySignerSetupFailed();
					await tx.wait();
					console.log(`success`);
				} catch (err) {
					console.log(`failed to call notifySignerSetupFailed`);
				}
			} else if (depositState.toNumber() === 5) {
				// Check if withdrawal request has timed out.
				try {
					console.log(`try to call notifySignatureTimeout`);
					const tx = await d.notifySignatureTimeout();
					await tx.wait();
					console.log(`success`);
				} catch (err) {
					console.log(`failed to call notifySignatureTimeout`);
				}
			}

			const w = await d.withdrawableAmount();
			if (w.gt(0)) {
				console.log(`we can withdraw: ${ethers.utils.formatEther(w.toString())}`)
				const wTx = await d.withdrawFunds();
				await wTx.wait();
			}
		}

	} catch(err) {
		console.error(`Could not authorize: ${err.message}`)
		process.exit(1)
	}
}

main().catch(err => {
	console.error(err);
})



