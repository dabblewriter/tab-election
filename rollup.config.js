import buble from 'rollup-plugin-buble';

export default {
  input: 'src/index.js',
  output: {
    format: 'cjs',
    file: 'dist/index.js'
  },
  sourcemap: true,
  plugins: [
    buble({
      exclude: 'node_modules/**' // only transpile our source code
    })
  ],
  onwarn: warning => {
    if (/external dependency/.test(warning.message)) return;
    console.warn(warning.message);
  }
};
