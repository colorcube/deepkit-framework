/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { ExtractClassDefinition, jsonSerializer, PlainSchemaProps, t } from '@deepkit/type';
import { ConfigDefinition, InjectorModule, InjectorToken, ProviderWithScope } from '@deepkit/injector';
import { ClassType, CustomError, getClassName } from '@deepkit/core';
import { EventListener } from '@deepkit/event';
import type { WorkflowDefinition } from '@deepkit/workflow';
import { isProvided } from './service-container';

export type DefaultObject<T> = T extends undefined ? {} : T;
export type ExtractConfigOfDefinition<T> = T extends ConfigDefinition<infer C> ? C : {};
// export type ExtractPartialConfigOfDefinition<T> = T extends ConfigDefinition<infer C> ? C : {};
// export type ModuleConfigOfOptions<O extends ModuleOptions> = ExtractPartialConfigOfDefinition<DefaultObject<O['config']>>;

export interface MiddlewareConfig {
    getClassTypes(): ClassType[];
}

export type MiddlewareFactory = () => MiddlewareConfig;

export interface ModuleDefinition {
    /**
     * Providers.
     */
    providers?: ProviderWithScope[];

    /**
     * Export providers (its token `provide` value) or modules you imported first.
     */
    exports?: (ClassType | InjectorToken<any> | string | AppModule<any>)[];

    /**
     * Module bootstrap class. This class is instantiated on bootstrap and can
     * setup various injected services. A more flexible alternative is to use .setup() with compiler passes.
     */
    bootstrap?: ClassType;

    /**
     * Configuration definition.
     *
     * @example
     * ```typescript
     * import {t} from '@deepkit/type';
     *
     * const myModuleConfig = new AppModuleConfig({
     *     debug: t.boolean.default(false),
     * });
     *
     * const myModule = new AppModule({
     *     config: myModuleConfig
     * });
     * ```
     */
    config?: ConfigDefinition<any>;

    /**
     * CLI controllers.
     */
    controllers?: ClassType[];

    /**
     * Register created workflows. This allows the Framework Debugger to collect
     * debug information and display the graph of your workflow.
     */
    workflows?: WorkflowDefinition<any>[];

    /**
     * Event listeners.
     *
     * @example with simple functions
     * ```typescript
     * {
     *     listeners: [
     *         onEvent.listen((event: MyEvent) => {console.log('event triggered', event);}),
     *     ]
     * }
     * ```
     *
     * @example with services
     * ```typescript
     *
     * class MyListener {
     *     @eventDispatcher.listen(onEvent)
     *     onEvent(event: typeof onEvent['type']) {
     *         console.log('event triggered', event);
     *     }
     * }
     *
     * {
     *     listeners: [
     *         MyListener,
     *     ]
     * }
     * ```
     */
    listeners?: (EventListener<any> | ClassType)[];

    /**
     * HTTP middlewares.
     */
    middlewares?: MiddlewareFactory[];
}

export interface CreateModuleDefinition extends ModuleDefinition {
    /**
     * Whether all services should be moved to the root module/application.
     */
    forRoot?: true;

    /**
     * Modules can not import other modules in the module definitions.
     * Use instead:
     *
     * ```typescript
     * class MyModule extends createModule({}) {
     *     imports = [new AnotherModule];
     * }
     * ```
     */
    imports?: undefined;
}


export interface RootModuleDefinition extends ModuleDefinition {
    /**
     * Import another module.
     */
    imports?: AppModule<any>[];
}

export class ConfigurationInvalidError extends CustomError {
}

let moduleId = 0;

export class AppModuleConfig<T extends PlainSchemaProps> extends ConfigDefinition<ExtractClassDefinition<T>> {
    constructor(public config: T) {
        super(t.schema(config));
    }
}

export function createModuleConfig<T extends PlainSchemaProps>(config: T): AppModuleConfig<T> {
    return new AppModuleConfig(config);
}

export interface AppModuleClass<C> {
    new(config?: Partial<C>): AppModule<any, C>;
}

/**
 * Creates a new module class type from which you can extend.
 *
 * name: The lowercase alphanumeric module name. This is used in the configuration system.
 * Choose a short unique name for best usability. If you don't have any configuration
 * or if you want that your configuration options are available without prefix, you can keep this undefined.
 *
 * ```typescript
 * class MyModule extends createModule({}) {}
 *
 * //and used like this
 * new App({
 *     imports: [new MyModule]
 * });
 * ```
 */
export function createModule<T extends CreateModuleDefinition>(options: T, name: string = ''): AppModuleClass<ExtractConfigOfDefinition<T['config']>> {
    return class AnonAppModule extends AppModule<T> {
        constructor(config?: Partial<ExtractConfigOfDefinition<T['config']>>) {
            super(options, name);
            if (config) {
                this.configure(config);
            }
        }
    } as any;
}

export class AppModule<T extends RootModuleDefinition, C extends ExtractConfigOfDefinition<T['config']> = any> extends InjectorModule<C> {
    public setupConfigs: ((module: AppModule<any>, config: any) => void)[] = [];

    public imports: AppModule<any>[] = [];

    constructor(
        public options: T,
        public name: string = '',
        public setups: ((module: AppModule<any>, config: any) => void)[] = [],
        public id: number = moduleId++,
    ) {
        super();
        if (this.options.imports) {
            for (const m of this.options.imports) this.addImport(m);
        }
        if (this.options.providers) this.providers.push(...this.options.providers);
        if (this.options.exports) this.exports.push(...this.options.exports);

        if ('forRoot' in this.options) this.forRoot();

        if (this.options.config) {
            //apply defaults
            const defaults: any = jsonSerializer.for(this.options.config.schema).deserialize({});
            //we iterate over so we have the name available on the object, even if its undefined
            for (const property of this.options.config.schema.getProperties()) {
                (this.config as any)[property.name] = defaults[property.name];
            }
        }
    }

    /**
     * When all configuration loaders have been loaded, this method is called.
     * It allows to further manipulate the module state depending on the final config.
     */
    process() {

    }

    /**
     * After `process` and when all modules have been processed by the service container.
     * This is also after `handleController` and `handleProviders` have been called and the full
     * final module tree is known. Adding now new providers or modules doesn't have any effect.
     *
     * Last chance to setup the injector context, via this.setupProvider().
     */
    postProcess() {

    }

    /**
     * A hook point to the service container. Allows to react on controllers registered in some module.
     */
    handleControllers(module: AppModule<any>, controllers: ClassType[]) {

    }

    /**
     * Renames this module instance.
     */
    rename(name: string): this {
        this.name = name;
        return this;
    }

    /**
     * A hook point to the service container. Allows to react on providers registered in some module.
     */
    handleProviders(module: AppModule<any>, providers: ProviderWithScope[]) {

    }

    getImports(): AppModule<ModuleDefinition>[] {
        return this.imports;
    }

    getImportedModulesByClass<T extends AppModule<any>>(classType: ClassType<T>): T[] {
        return this.getImports().filter(v => v instanceof classType) as T[];
    }

    getImportedModuleByClass<T extends AppModule<any>>(classType: ClassType<T>): T {
        const v = this.getImports().find(v => v instanceof classType);
        if (!v) {
            throw new Error(`No module ${getClassName(classType)} in ${getClassName(this)}#${this.id} imported.`);
        }
        return v as T;
    }

    getImportedModule<T extends AppModule<any>>(module: T): T {
        const v = this.getImports().find(v => v.id === module.id);
        if (!v) {
            throw new Error(`No module ${getClassName(module)}#${module.id} in ${getClassName(this)}#${this.id} imported.`);
        }
        return v as T;
    }

    getExports() {
        return this.exports;
    }

    hasImport(moduleClass: AppModuleClass<any>): boolean {
        for (const importModule of this.getImports()) {
            if (importModule instanceof moduleClass) return true;
        }
        return false;
    }

    /**
     * Modifies this module and adds a new import, returning the same module.
     */
    addImport(...modules: AppModule<any>[]): this {
        this.assertInjectorNotBuilt();
        for (const module of modules) {
            module.setParent(this);
        }
        return this;
    }

    addController(...controller: ClassType[]) {
        this.assertInjectorNotBuilt();
        if (!this.options.controllers) this.options.controllers = [];

        this.options.controllers.push(...controller);
    }

    isProvided(classType: ClassType): boolean {
        return isProvided(this.getProviders(), classType);
    }

    addProvider(...provider: ProviderWithScope[]): this {
        this.assertInjectorNotBuilt();
        this.providers.push(...provider);
        return this;
    }

    getProviders(): ProviderWithScope[] {
        return this.providers;
    }

    addListener(...listener: (EventListener<any> | ClassType)[]): this {
        this.assertInjectorNotBuilt();
        if (!this.options.listeners) this.options.listeners = [];

        this.options.listeners.push(...listener);
        return this;
    }

    addMiddleware(...middlewares: MiddlewareFactory[]): this {
        if (!this.options.middlewares) this.options.middlewares = [];

        this.options.middlewares.push(...middlewares);
        return this;
    }

    getName(): string {
        return this.name;
    }

    /**
     * Allows to change the module config before `setup` and bootstrap is called. This is the last step right before the config is validated.
     */
    setupConfig(callback: (module: AppModule<T>, config: C) => void): this {
        this.setupConfigs.push(callback as any);
        return this;
    }

    /**
     * Allows to change the module after the configuration has been loaded, right before the application bootstraps (thus loading all services/controllers/etc).
     */
    setup(callback: (module: AppModule<T>, config: C) => void): this {
        this.setups.push(callback);
        return this;
    }

    /**
     * Sets configured values.
     */
    configure(config: Partial<C>): this {
        for (const module of this.getImports()) {
            if (!module.getName()) continue;
            if (!(module.getName() in config)) continue;
            const newModuleConfig = (config as any)[module.getName()];
            module.configure(newModuleConfig);
        }

        if (this.options.config) {
            const configNormalized = jsonSerializer.for(this.options.config.schema).partialDeserialize(config);
            Object.assign(this.config, configNormalized);
        }

        return this;
    }
}
