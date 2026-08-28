import { ConfigLoader } from '../src/config/configLoader.js';
import { ProcessRunner } from '../src/utils/processRunner.js';
import { checkToolchain } from '../src/utils/toolchain.js';

const runner = new ProcessRunner();
try {
  const config = await new ConfigLoader().load();
  process.stdout.write(JSON.stringify(await checkToolchain(config, runner), null, 2) + '\n');
} finally {
  await runner.dispose();
}
