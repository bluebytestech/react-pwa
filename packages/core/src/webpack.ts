import path from 'node:path';
import fs from 'node:fs';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import webpack, { RuleSetRule } from 'webpack';
import ReactRefreshWebpackPlugin from '@pmmmwh/react-refresh-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';
import { notBoolean } from './utils/not-boolean.js';
import { getServiceWorker } from './webpack/service-worker.js';
import { getResolve, getResolveLoader } from './webpack/resolver.js';
import { getMjsRule } from './webpack/rules/mjs-rule.js';
import { getCssRule } from './webpack/rules/css-rule.js';
import { getServerOptimization, getWebOptimization } from './webpack/optimization.js';
import { getExperiments } from './webpack/experiments.js';
import { getJsRule } from './webpack/rules/js-rule.js';
import { getRawResourceRule } from './webpack/rules/raw-resource-rule.js';
import { getImagesRule } from './webpack/rules/images-rule.js';
import { getAssetsRule } from './webpack/rules/assets-rule.js';
import { libSrc } from './root.js';
import { WebpackHandlerConstructorOptions } from './typedefs/webpack.js';
import { getNodeExternals } from './webpack/externals.js';
import { getServerOutput, getWebOutput } from './webpack/output.js';

export const extensionRegex = (assetsList: string[]) => new RegExp(`\\.(${assetsList.join('|')})$`);

const defaultConfig = {
  react: {
    strictMode: true,
  },
  serviceWorker: true,
};

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
export class WebpackHandler {
  protected configOptions: Record<string, any> = defaultConfig;

  protected options: WebpackHandlerConstructorOptions;

  constructor(
    options: Optional<WebpackHandlerConstructorOptions, 'buildWithHttpServer' | 'envVars' | 'config' | 'copyPublicFolder' | 'useBuildtimeGeneratorOptions'>,
  ) {
    this.options = {
      buildWithHttpServer: false,
      envVars: {},
      config: {},
      copyPublicFolder: false,
      useBuildtimeGeneratorOptions: true,
      ...options,
    };

    const { react, serviceWorker, ...otherOptions } = options?.config ?? {};
    this.configOptions = {
      react: {
        StrictMode: true,
        ...(react ?? {}),
      },
      serviceWorker: serviceWorker ?? !this.isDevelopment,
      ...otherOptions,
    };
  }

  get isDevelopment() {
    return this.options.mode === 'development';
  }

  get isTargetWeb() {
    return this.options.target === 'web';
  }

  get isTargetServer() {
    return this.options.target === 'node';
  }

  get shouldHotReload() {
    return this.isDevelopment && this.isTargetWeb;
  }

  getEntry(): webpack.Configuration['entry'] {
    if (this.isTargetWeb) {
      return [
        this.shouldHotReload && 'webpack-hot-middleware/client?reload=true',
        this.shouldHotReload && 'react-refresh/runtime',
        path.resolve(libSrc, 'client.js'),
      ].filter(notBoolean);
    }
    if (this.isTargetServer) {
      if (this.options.buildWithHttpServer) {
        return [path.resolve(libSrc, 'fastify-server.js')].filter(notBoolean);
      }
      return [path.resolve(libSrc, 'server.js')].filter(notBoolean);
    }
    return [];
  }

  getOptimization(): webpack.Configuration['optimization'] {
    if (this.isTargetWeb) {
      return getWebOptimization({ minimize: !this.isDevelopment });
    }
    if (this.isTargetServer) {
      return getServerOptimization({ minimize: !this.isDevelopment });
    }
    return undefined;
  }

  getOutput(): webpack.Configuration['output'] {
    if (this.isTargetWeb) {
      return getWebOutput({ projectRoot: this.options.projectRoot });
    }
    if (this.isTargetServer) {
      return getServerOutput({ projectRoot: this.options.projectRoot });
    }
    return undefined;
  }

  getDevtool(): webpack.Configuration['devtool'] {
    return this.isDevelopment ? 'eval-source-map' : false;
  }

  getContext(): webpack.Configuration['context'] {
    return this.options.projectRoot;
  }

  getFilteredEnvVars() {
    if (this.isTargetServer) {
      return this.options.envVars;
    }
    const envVars: Record<string, any> = {};
    const envKeys = Object.keys(this.options.envVars);
    for (let i = 0; i < envKeys.length; i += 1) {
      if (!envKeys[i].startsWith('_PRIVATE_')) {
        envVars[envKeys[i]] = this.options.envVars[envKeys[i]];
      }
    }
    return envVars;
  }

  canCopyPublicFolder(): Boolean {
    if (!this.options.copyPublicFolder) {
      return false;
    }
    if (!this.getOutput()?.path) {
      return false;
    }
    const pathToPublicFolder = path.resolve(this.options.projectRoot, 'src', 'public');
    try {
      return fs.statSync(pathToPublicFolder).isDirectory();
    } catch {
      // do nothing
    }
    return false;
  }

  getServiceWorkerPlugin() {
    /**
     * Only emit service worker for target web and if the
     * user has not specified serviceWorker as false in the
     * config options
     */
    if (
      !this.isTargetWeb
      || this.configOptions.serviceWorker === false
    ) {
      return false;
    }
    return getServiceWorker(
      this.options.projectRoot,
      this.configOptions.serviceWorker,
    );
  }

  getPlugins(): webpack.Configuration['plugins'] {
    return [
      new webpack.DefinePlugin({
        ...(this.isTargetWeb ? { 'process.env': {} } : {}),
        EnableReactStrictMode: this.configOptions.react.StrictMode && this.isDevelopment,
        EnableServiceWorker: this.configOptions.serviceWorker !== false,
      }),
      new webpack.EnvironmentPlugin({
        ...this.getFilteredEnvVars(),
      }),
      this.shouldHotReload && new webpack.HotModuleReplacementPlugin(),
      this.shouldHotReload
        && new ReactRefreshWebpackPlugin({ esModule: true, overlay: { sockProtocol: 'ws' } }),
      this.shouldHotReload
        || new MiniCssExtractPlugin({
          filename: 'css/[contenthash].css',
          chunkFilename: 'css/[chunkhash].css',
          ignoreOrder: true,
        }),
      this.isTargetServer
        && new webpack.optimize.LimitChunkCountPlugin({
          maxChunks: 1,
        }),
      this.canCopyPublicFolder() && new CopyPlugin({
        patterns: [
          {
            from: path.resolve(this.options.projectRoot, 'src', 'public'),
            to: path.join(this.getOutput()?.path ?? '', 'public'),
          },
        ],
      }),
      this.getServiceWorkerPlugin(),
    ].filter(notBoolean);
  }

  getRules(): RuleSetRule[] {
    return [
      getMjsRule(),
      getAssetsRule({
        withBuild: this.isTargetServer,
        useBuildtimeGeneratorOptions: !!this.options.useBuildtimeGeneratorOptions,
      }),
      getImagesRule({
        withBuild: this.isTargetServer,
        useBuildtimeGeneratorOptions: !!this.options.useBuildtimeGeneratorOptions,
      }),
      getRawResourceRule({ emit: this.isTargetWeb }),
      getJsRule({
        isTargetServer: this.isTargetServer,
        hotReload: this.shouldHotReload,
        projectRoot: this.options.projectRoot,
      }),
      getCssRule({
        hotReload: this.shouldHotReload,
        emit: this.isTargetWeb,
        sourceMap: this.isDevelopment,
        detailedIdentName: this.isDevelopment,
        context: path.resolve(this.options.projectRoot, 'src'),
      }),
    ];
  }

  getConfig(): webpack.Configuration {
    return {
      mode: this.options.mode,
      entry: this.getEntry(),
      optimization: this.getOptimization(),
      experiments: getExperiments({ outputModule: this.isTargetWeb }),
      output: this.getOutput(),
      externalsPresets: this.isTargetServer ? { node: true } : undefined,
      externals: this.isTargetServer
        ? [getNodeExternals({ projectRoot: this.options.projectRoot })]
        : undefined,
      module: {
        rules: this.getRules(),
      },
      resolve: getResolve({
        projectRoot: this.options.projectRoot,
      }),
      resolveLoader: getResolveLoader(),
      devtool: this.getDevtool(),
      context: this.getContext(),
      target: this.options.target,
      plugins: this.getPlugins(),
    };
  }
}