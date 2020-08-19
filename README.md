# tBTC redeemer

This is a simple set of scripts to redeem tBTC automatically.

There are two parts:

1. `index.js` interacts with the vending machine to burn tBTC
2. `listener.js` waits for the redemption requests and subsequent signatures,
	 which are then broadcasted to the bitcoin testnet.

Start the listener first and then fire up the redeemer.

Redeemer:

```Bash
$ INFURA_API=APIKEYGOESHERE node --experimental-json-modules index.js WALLETPASSWORD
```

Listener:

```Bash
$ INFURA_API=APIKEYGOESHERE node --experimental-json-modules listener.js REDEEMERADDR
```
