import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { RuleSetRule } from 'webpack';
import { notBoolean } from '../../utils/not-boolean.js';
import { getCssLoaderOptions } from '../loader-options/css-loader-options.js';
import { getPostcssLoaderOptions } from '../loader-options/post-css-loader-options.js';
import { getSassLoaderOptions } from '../loader-options/sass-loader-options.js';

export const getCssRule = (options: {
  hotReload: boolean;
  emit: boolean;
  sourceMap: boolean;
  detailedIdentName: boolean;
  context: string;
}): RuleSetRule => ({
  test: /\.(css|s[ac]ss)$/i,
  use: [
    options.hotReload && { loader: 'style-loader' },
    options.hotReload || {
      loader: MiniCssExtractPlugin.loader,
      options: { emit: options.emit },
    },
    {
      loader: 'css-loader',
      options: getCssLoaderOptions({
        sourceMap: options.sourceMap,
        detailedIdentName: options.detailedIdentName,
        context: options.context,
      }),
    },
    {
      loader: 'postcss-loader',
      options: getPostcssLoaderOptions(),
    },
    // Compiles Sass to CSS
    {
      loader: 'sass-loader',
      options: getSassLoaderOptions(),
    },
  ].filter(notBoolean),
});
