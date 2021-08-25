import { useCallback } from 'react';

import { useSelector } from '@xstate/react';
import {
  ActorRefFrom,
  assign,
  createMachine,
  createSchema,
  send,
  sendParent,
} from 'xstate';
import { createModel } from 'xstate/lib/model';

import { ConnectorType } from '@rhoas/connector-management-sdk';

import {
  ApiSuccessResponse,
  getPaginatedApiMachineEvents,
  getPaginatedApiMachineEventsHandlers,
  makePaginatedApiMachine,
  PaginatedApiActorType,
  PaginatedApiRequest,
  usePagination,
} from './PaginatedResponse.machine';
import { ConnectorTypesQuery, fetchConnectorTypes } from './api';
import { PAGINATED_MACHINE_ID } from './constants';

type Context = {
  accessToken: () => Promise<string>;
  basePath: string;
  response?: ApiSuccessResponse<ConnectorType>;
  selectedConnector?: ConnectorType;
  error?: Object;
};

const connectorTypesMachineSchema = {
  context: createSchema<Context>(),
};

const connectorTypesMachineModel = createModel(
  {
    accessToken: () => Promise.resolve(''),
    basePath: '',
    response: undefined,
    selectedConnector: undefined,
    error: undefined,
  } as Context,
  {
    events: {
      selectConnector: (payload: { selectedConnector: string }) => ({
        ...payload,
      }),
      deselectConnector: () => ({}),
      confirm: () => ({}),
      ...getPaginatedApiMachineEvents<
        ConnectorType,
        ConnectorTypesQuery,
        ConnectorType
      >(),
    },
  }
);

export const connectorTypesMachine = createMachine<
  typeof connectorTypesMachineModel
>(
  {
    schema: connectorTypesMachineSchema,
    context: connectorTypesMachineModel.initialContext,
    id: 'connectors',
    initial: 'root',
    states: {
      root: {
        type: 'parallel',
        states: {
          api: {
            initial: 'idle',
            invoke: {
              id: PAGINATED_MACHINE_ID,
              src: (context) =>
                makePaginatedApiMachine<
                  ConnectorType,
                  ConnectorTypesQuery,
                  ConnectorType
                >(fetchConnectorTypes(context), (i) => i),
            },
            states: {
              idle: {
                entry: send(
                  {
                    type: 'api.query',
                    query: { categories: ['sink', 'source'] },
                  },
                  { to: PAGINATED_MACHINE_ID }
                ),
                on: {
                  'api.ready': 'ready',
                },
              },
              ready: {},
            },
            on: {
              ...getPaginatedApiMachineEventsHandlers(PAGINATED_MACHINE_ID),
              'api.success': { actions: 'success' },
            },
          },
          selection: {
            id: 'selection',
            initial: 'verify',
            states: {
              verify: {
                always: [
                  { target: 'selecting', cond: 'noConnectorSelected' },
                  { target: 'valid', cond: 'connectorSelected' },
                ],
              },
              selecting: {
                entry: sendParent('isInvalid'),
                on: {
                  selectConnector: {
                    target: 'valid',
                    actions: 'selectConnector',
                    cond: (_, event) => event.selectedConnector !== undefined,
                  },
                },
              },
              valid: {
                entry: sendParent('isValid'),
                on: {
                  selectConnector: {
                    target: 'verify',
                    actions: 'selectConnector',
                  },
                  deselectConnector: {
                    target: 'verify',
                    actions: 'reset',
                  },
                  confirm: {
                    target: '#done',
                    cond: 'connectorSelected',
                  },
                },
              },
            },
          },
        },
      },
      done: {
        id: 'done',
        type: 'final',
        data: {
          selectedConnector: (context: Context) => context.selectedConnector,
        },
      },
    },
  },
  {
    actions: {
      success: assign((_context, event) => {
        if (event.type !== 'api.success') return {};
        const { type, ...response } = event;
        return {
          response,
        };
      }),
      selectConnector: assign({
        selectedConnector: (context, event) => {
          if (event.type === 'selectConnector') {
            return context.response?.items?.find(
              (i) => i.id === event.selectedConnector
            );
          }
          return context.selectedConnector;
        },
      }),
      reset: assign({
        selectedConnector: (context, event) =>
          event.type === 'deselectConnector'
            ? undefined
            : context.selectedConnector,
      }),
    },
    guards: {
      connectorSelected: (context) => context.selectedConnector !== undefined,
      noConnectorSelected: (context) => context.selectedConnector === undefined,
    },
  }
);

export type ConnectorTypesMachineActorRef = ActorRefFrom<
  typeof connectorTypesMachine
>;

export const useConnectorTypesMachineIsReady = (
  actor: ConnectorTypesMachineActorRef
) => {
  return useSelector(
    actor,
    useCallback(
      (state: typeof actor.state) => {
        return state.matches({ root: { api: 'ready' } });
      },
      [actor]
    )
  );
};

export const useConnectorTypesMachine = (
  actor: ConnectorTypesMachineActorRef
) => {
  const api = usePagination<ConnectorType, ConnectorTypesQuery, ConnectorType>(
    actor.state.children[PAGINATED_MACHINE_ID] as PaginatedApiActorType<
      ConnectorType,
      ConnectorTypesQuery,
      ConnectorType
    >
  );
  const { selectedId } = useSelector(
    actor,
    useCallback(
      (state: typeof actor.state) => ({
        selectedId: state.context.selectedConnector?.id,
      }),
      [actor]
    )
  );
  const onSelect = useCallback(
    (selectedConnector: string) => {
      actor.send({ type: 'selectConnector', selectedConnector });
    },
    [actor]
  );
  const onQuery = useCallback(
    (request: PaginatedApiRequest<ConnectorTypesQuery>) => {
      actor.send({ type: 'api.query', ...request });
    },
    [actor]
  );
  return {
    ...api,
    selectedId,
    onSelect,
    onQuery,
  };
};
