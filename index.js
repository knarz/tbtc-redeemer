import fs from 'fs';
import ethers from 'ethers';
import BN from 'bn.js';

import BitcoinHelpers from '../tbtc.js/src/BitcoinHelpers.js';
import EthereumHelpers from '../tbtc.js/src/EthereumHelpers.js';

import TBTCSystem from "@keep-network/tbtc/artifacts/TBTCSystem.json";
import VendingMachine from "@keep-network/tbtc/artifacts/VendingMachine.json";
import TBTCToken from "@keep-network/tbtc/artifacts/TBTCToken.json";
import TBTCDepositToken from "@keep-network/tbtc/artifacts/TBTCDepositToken.json";
import Deposit from "@keep-network/tbtc/artifacts/Deposit.json";
import BondedECDSAKeep from "@keep-network/keep-ecdsa/artifacts/BondedECDSAKeep.json";

if (process.argv.length < 3 || !process.argv[2] || !process.argv[3]) {
	console.error('node access.js [password] [btc-addr]');
	process.exit(1);
}

async function main() {
	let wallet
	try {
		const j = fs.readFileSync('wallet.json', 'utf8');
		const w  = await new ethers.Wallet.fromEncryptedJson(j, process.argv[2]);
		const ip = new ethers.providers.InfuraProvider('ropsten', process.env.INFURA_API);
		wallet = w.connect(ip);

		const tbtcSysContract = new ethers.Contract(TBTCSystem.networks["3"].address, TBTCSystem.abi, wallet);
		const vendingContract = new ethers.Contract(VendingMachine.networks["3"].address, VendingMachine.abi, wallet);
		const tokenContract = new ethers.Contract(TBTCToken.networks["3"].address, TBTCToken.abi, wallet);
		const tdtContract = new ethers.Contract(TBTCDepositToken.networks["3"].address, TBTCDepositToken.abi, wallet);

		let tbtcBalance = await tokenContract.balanceOf(wallet.address);
		console.log(`I own ${ethers.utils.formatEther(tbtcBalance.toString())} tBTC`);
		//console.log(tdtContract);

		const transfers = await tdtContract.queryFilter(tdtContract.filters.Transfer(null, vendingContract.address));
		// Signing groups for the oldest deposits are most likely not available
		// anymore, so we just start with the newest.
		const tokenIDs = transfers.map(t => { return t.args[2].toHexString()}).reverse();
		//console.log(tokenIDs);

		if ((await tokenContract.allowance(wallet.address, vendingContract.address)).lt(tbtcBalance)) {
			console.log(`approving vending machine to spend all of our tbtc`);
			const approveTx = await tokenContract.approve(vendingContract.address, tbtcBalance);
			await approveTx.wait();
		} else {
			console.log(`no need to approve vending machine spending`);
		}

		const rawOutputScript = BitcoinHelpers.Address.toRawScript(process.argv[3]);
		const outputScript =
      "0x" +
      Buffer.concat([
        Buffer.from([rawOutputScript.length]),
        rawOutputScript
      ]).toString("hex");
		console.log(`outputScript ${outputScript}`);
		const txFee = ethers.BigNumber.from("150"); // Can probably be hardcoded
		const activeTDTs = new Array();
		for (let tokenID of tokenIDs) {
			const d = new ethers.Contract(tokenID, Deposit.abi, wallet);
			const k = new ethers.Contract(await d.getKeepAddress(), BondedECDSAKeep.abi, wallet);

			const outputValue = (await d.utxoValue()).sub(txFee);
			const outputValueBytes = (new BN(outputValue.toString())).toArrayLike(Buffer, "le", 8);

			tbtcBalance = await tokenContract.balanceOf(wallet.address);
			const lots = await d.lotSizeTbtc();
			if (lots.gt(tbtcBalance)) {
				console.log(`lot size ${ethers.utils.formatEther(lots.toString())} and we have only ${ethers.utils.formatEther(tbtcBalance.toString())}`)
				continue;
			}

			const dActive = await d.inActive();
			console.log(`[${tokenID}] is active (${dActive}) @ ${ethers.utils.formatEther(lots.toString())} tBTC`);
			if (!dActive) {
				console.log(`skipping inactive`);
				continue;
			}

			const kActive = k.isActive();
			console.log(`belongs to keep ${k.address}; keep is active: ${await k.isActive()}`);
			if (!kActive) {
				console.log(`skipping inactive`);
				continue;
			}

			console.log(`asking for redemption via tbtcToBtc`);
			const vendingTx = await vendingContract.tbtcToBtc(d.address, outputValueBytes, outputScript);
			await vendingTx.wait();
		}

	} catch(err) {
		console.error(`Could not authorize: ${err.message}`)
		process.exit(1)
	}
}

main().catch(err => {
	console.error(err);
})


