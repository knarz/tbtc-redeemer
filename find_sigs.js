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
		const depositLogContract = new ethers.Contract(TBTCSystem.networks["3"].address, DepositLog.abi, wallet);

		const redemptionReqs = await depositLogContract.queryFilter(depositLogContract.filters.RedemptionRequested(null, wallet.address, null));
		for (let req of redemptionReqs) {
			const [deposit, requester, digest, val, script, fee, outpoint] = req.args;

			const d = new ethers.Contract(deposit, Deposit.abi, wallet);
			const k = new ethers.Contract(await d.getKeepAddress(), BondedECDSAKeep.abi, wallet);

			const sigs = await k.queryFilter(k.filters.SignatureSubmitted(digest));
			console.log(`${deposit} has ${sigs.length} redemption signatures`);
		}

	} catch(err) {
		console.error(`Could not authorize: ${err.message}`)
		process.exit(1);
	}
}

main().catch(err => {
	console.error(err);
})

