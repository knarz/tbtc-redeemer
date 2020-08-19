import fs from 'fs';
import ethers from 'ethers';

import BitcoinHelpers from '../tbtc.js/src/BitcoinHelpers.js';
import EthereumHelpers from '../tbtc.js/src/EthereumHelpers.js';

import TBTCSystem from "@keep-network/tbtc/artifacts/TBTCSystem.json";
import VendingMachine from "@keep-network/tbtc/artifacts/VendingMachine.json";
import TBTCToken from "@keep-network/tbtc/artifacts/TBTCToken.json";
import TBTCDepositToken from "@keep-network/tbtc/artifacts/TBTCDepositToken.json";
import Deposit from "@keep-network/tbtc/artifacts/Deposit.json";
import BondedECDSAKeep from "@keep-network/keep-ecdsa/artifacts/BondedECDSAKeep.json";
import DepositLog from "@keep-network/tbtc/artifacts/DepositLog.json";

if (process.argv.length < 3 || !process.argv[2]) {
	console.error('node listener.js [redeemer-addr]');
	process.exit(1);
}

async function main() {
	try {
		const ip = new ethers.providers.InfuraProvider('ropsten', process.env.INFURA_API);

		const tbtcSysContract = new ethers.Contract(TBTCSystem.networks["3"].address, TBTCSystem.abi, ip);
		const vendingContract = new ethers.Contract(VendingMachine.networks["3"].address, VendingMachine.abi, ip);
		const tokenContract = new ethers.Contract(TBTCToken.networks["3"].address, TBTCToken.abi, ip);
		const tdtContract = new ethers.Contract(TBTCDepositToken.networks["3"].address, TBTCDepositToken.abi, ip);
		const depositLogContract = new ethers.Contract(TBTCSystem.networks["3"].address, DepositLog.abi, ip);

		BitcoinHelpers.setElectrumConfig({
			testnetWS: {
				server: "tn.not.fyi",
				port: 55002,
				protocol: "ssl"
			}
		});

		const redeemerAddr = process.argv[2];
		const redemptionReqs = await depositLogContract.queryFilter(depositLogContract.filters.RedemptionRequested(null, redeemerAddr, null));
		//console.log(redemptionReqs);

		depositLogContract.on(depositLogContract.filters.RedemptionRequested(null, redeemerAddr, null), async (...args) => {
			const [ depositAddr, requester, digest, utxoValue, redeemerOutputScript, requestedFee, outpoint] = args;
			console.log(`redeeming ${depositAddr} for ${requester}`);
			const outputVal = utxoValue.sub(requestedFee);
			const unsignedTransaction = BitcoinHelpers.Transaction.constructOneInputOneOutputWitnessTransaction(
				outpoint.replace("0x", ""),
				0,
				outputVal.toNumber(),
				EthereumHelpers.bytesToRaw(redeemerOutputScript)
			);

			console.log(`unsignedTransaction: ${unsignedTransaction}`);

			const d = new ethers.Contract(depositAddr, Deposit.abi, ip);
			const k = new ethers.Contract(await d.getKeepAddress(), BondedECDSAKeep.abi, ip);

			const depositPks = await tbtcSysContract.queryFilter(tbtcSysContract.filters.RegisteredPubkey(d.address));

			if (depositPks.length < 1) {
				console.log(`could not find PK for deposit ${depositAddr}`);
				return;
			}

			const pk = depositPks[depositPks.length - 1].args;
			// 0. depositAddr, 1. X, 2. Y, 3. timestamp

			console.log(`waiting for signature`);
			k.once(k.filters.SignatureSubmitted(digest), async (dig, r, s, recovery) => {
				console.log(`got signature for ${d.address} spending ${outputVal.toString()}`)
				const signedTransaction = BitcoinHelpers.Transaction.addWitnessSignature(
					unsignedTransaction,
					0,
					r.replace("0x", ""),
					s.replace("0x", ""),
					BitcoinHelpers.publicKeyPointToPublicKeyString(
						pk[1],
						pk[2]
					)
				);

				console.log(`broadcasting signedTransaction: ${signedTransaction}`);
				const bTx = await BitcoinHelpers.Transaction.broadcast(signedTransaction);
				console.log(`txid: ${bTx.transactionID}`);
			});
		});

	} catch(err) {
		console.error(`Could not authorize: ${err.message}`)
		process.exit(1);
	}
}

main().catch(err => {
	console.error(err);
})


