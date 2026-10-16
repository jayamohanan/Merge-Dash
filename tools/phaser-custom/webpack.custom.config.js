'use strict';
// THE CUSTOM PHASER BUILD — the game's phaser.min.js.
// phaser-custom.js is Phaser's own src/phaser-core.js plus what the game uses
// beyond it: Container, Particles, Rectangle, Ellipse, Geom.Rectangle,
// Math.Clamp. No sound, no physics, no tilemaps. ~183KB gzipped vs 317KB full.
//
// TO REBUILD (e.g. after a Phaser upgrade — then re-check phaser-core.js
// against phaser-custom.js for anything renamed):
//   git clone --depth 1 --branch v3.90.0 https://github.com/phaserjs/phaser.git
//   cd phaser && npm install
//   cp <this folder>/phaser-custom.js src/
//   cp <this folder>/webpack.custom.config.js config/
//   npx webpack --config config/webpack.custom.config.js
//   -> dist-custom/phaser-custom.min.js, copied over the game's phaser.min.js
//
// IF THE GAME STARTS USING A NEW KIND OF GAME OBJECT (this.add.sprite is in;
// e.g. this.add.circle, this.add.renderTexture are not), add its class,
// Factory and Creator to phaser-custom.js the way Container is, and rebuild.
// Missing one shows as "this.add.xxx is not a function".
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    mode: 'production',
    context: `${__dirname}/../src/`,
    entry: { 'phaser-custom.min': './phaser-custom.js' },
    output: {
        path: `${__dirname}/../dist-custom/`,
        filename: '[name].js',
        globalObject: 'this',
        library: { name: 'Phaser', type: 'umd', umdNamedDefine: true }
    },
    performance: { hints: false },
    optimization: {
        minimizer: [ new TerserPlugin({
            parallel: true, extractComments: false,
            terserOptions: { format: { comments: false }, compress: true, ie8: false, ecma: 5 }
        }) ]
    },
    plugins: [ new webpack.DefinePlugin({
        "typeof CANVAS_RENDERER": JSON.stringify(true),
        "typeof WEBGL_RENDERER": JSON.stringify(true),
        "typeof WEBGL_DEBUG": JSON.stringify(false),
        "typeof EXPERIMENTAL": JSON.stringify(false),
        "typeof PLUGIN_3D": JSON.stringify(false),
        "typeof PLUGIN_CAMERA3D": JSON.stringify(false),
        "typeof PLUGIN_FBINSTANT": JSON.stringify(false),
        "typeof FEATURE_SOUND": JSON.stringify(false)
    }) ]
};
