// Focused network/UI fixtures keep hunters stationary; production index never disables AI.
import {createGameServer} from '../src/server.js';
const app=createGameServer({hunters:false});app.server.listen(3100,'0.0.0.0');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void app.close();});
