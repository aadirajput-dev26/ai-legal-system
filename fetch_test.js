import 'dotenv/config';
import { config } from './src/lib/config.js';
async function run() {
    console.log("Using API KEY:", config.GTWY_PAUTHKEY ? "Exists" : "Missing");
    try {
        const res = await fetch("https://indiacode.ecourtsindia.com/api/v1/acts?limit=1", {
            headers: {
                'x-api-key': config.GTWY_PAUTHKEY
            }
        });
        const data = await res.json();
        console.log("ACTS:", JSON.stringify(data, null, 2));
        const res2 = await fetch("https://indiacode.ecourtsindia.com/api/v1/instruments?limit=1", {
            headers: {
                'x-api-key': config.GTWY_PAUTHKEY
            }
        });
        const data2 = await res2.json();
        console.log("INSTRUMENTS:", JSON.stringify(data2, null, 2));
    }
    catch (e) {
        console.error(e);
    }
}
run();
