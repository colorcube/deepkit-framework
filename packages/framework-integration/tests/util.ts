import 'jest';
import {arrayRemoveItem, ClassType, sleep} from "@super-hornet/core";
import {ApplicationServer} from "@super-hornet/framework-server";
import {SocketClient} from "@super-hornet/framework-client";
import {RemoteController} from "@super-hornet/framework-shared";
import {Observable} from "rxjs";
import {createServer} from "http";
import {Module} from "@super-hornet/framework-server-common";

export async function subscribeAndWait<T>(observable: Observable<T>, callback: (next: T) => Promise<void>, timeout: number = 5): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const sub = observable.subscribe((next) => {
            callback(next);
            sub.unsubscribe();
            resolve();
        }, (error) => {
            reject(error);
        });
        setTimeout(() => {
            sub.unsubscribe();
            reject('Subscribe timeout');
        }, timeout * 1000);
    });
}

const closer: (() => Promise<void>)[] = [];

// doesn't work yet automatically
// afterEach(async () => {
//     for (const close of closer) {
//         await close();
//     }
// });

export async function closeAllCreatedServers() {
    for (const close of closer) {
        await close();
    }
}

export async function createServerClientPair(
    dbTestName: string,
    controllers: ClassType<any>[],
): Promise<{
    server: ApplicationServer,
    client: SocketClient,
    close: () => Promise<void>,
    createClient: () => SocketClient,
    createControllerClient: <T>(controllerName: string) => RemoteController<T>
}> {
    const dbName = 'super_hornet_tests_' + dbTestName.replace(/[^a-zA-Z0-9]+/g, '_');

    const socketPath = '/tmp/ws_socket_' + new Date().getTime() + '.' + Math.floor(Math.random() * 1000);
    const exchangeSocketPath = socketPath + '_exchange';

    const server = createServer();
    await new Promise((resolve) => {
        server.listen(socketPath, function () {
            resolve();
        });
    });

    @Module({
        controllers: controllers
    })
    class AppModule {

    }

    const app = new ApplicationServer(AppModule, {
        server: server,
        // mongoDbName: dbName,
        // exchangeUnixPath: exchangeSocketPath
    });

    await app.start();

    const createdClients: SocketClient[] = [];

    const socket = new SocketClient('ws+unix://' + socketPath);

    createdClients.push(socket);

    let closed = false;

    const close = async () => {
        arrayRemoveItem(closer, close);

        if (closed) {
            return;
        }

        console.log('server close ...');
        // await db.dropDatabase(dbName);
        closed = true;

        for (const client of createdClients) {
            try {
                client.disconnect();
            } catch (error) {
                console.error('failed disconnecting client');
                throw error;
            }
        }

        await sleep(0.1); //let the server read the disconnect
        const start = performance.now();
        await app.close();
        console.log('server closed', performance.now() - start);
    };

    closer.push(close);
    return {
        server: app,
        client: socket,
        createClient: () => {
            const client = new SocketClient('ws+unix://' + socketPath);
            createdClients.push(client);
            return client;
        },
        createControllerClient: <T>(controllerName: string): RemoteController<T> => {
            const client = new SocketClient('ws+unix://' + socketPath);
            createdClients.push(client);
            return client.controller<T>(controllerName);
        },
        close: close,
    };
}
