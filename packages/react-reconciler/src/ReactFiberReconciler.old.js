/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber, SuspenseHydrationCallbacks} from './ReactInternalTypes';
import type {FiberRoot} from './ReactInternalTypes';
import type {RootTag} from './ReactRootTags';
import type {
  Instance,
  TextInstance,
  Container,
  PublicInstance,
} from './ReactFiberHostConfig';
import type {RendererInspectionConfig} from './ReactFiberHostConfig';
import {FundamentalComponent} from './ReactWorkTags';
import type {ReactNodeList} from 'shared/ReactTypes';
import type {Lane, LanePriority} from './ReactFiberLane.old';
import type {SuspenseState} from './ReactFiberSuspenseComponent.old';

import {
  findCurrentHostFiber,
  findCurrentHostFiberWithNoPortals,
} from './ReactFiberTreeReflection';
import {get as getInstance} from 'shared/ReactInstanceMap';
import {
  HostComponent,
  ClassComponent,
  HostRoot,
  SuspenseComponent,
} from './ReactWorkTags';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';
import {enableSchedulingProfiler} from 'shared/ReactFeatureFlags';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {getPublicInstance} from './ReactFiberHostConfig';
import {
  findCurrentUnmaskedContext,
  processChildContext,
  emptyContextObject,
  isContextProvider as isLegacyContextProvider,
} from './ReactFiberContext.old';
import {createFiberRoot} from './ReactFiberRoot.old';
import {injectInternals, onScheduleRoot} from './ReactFiberDevToolsHook.old';
import {
  requestEventTime,
  requestUpdateLane,
  scheduleUpdateOnFiber,
  flushRoot,
  batchedEventUpdates,
  batchedUpdates,
  unbatchedUpdates,
  flushSync,
  flushControlled,
  deferredUpdates,
  discreteUpdates,
  flushDiscreteUpdates,
  flushPassiveEffects,
  warnIfNotScopedWithMatchingAct,
  warnIfUnmockedScheduler,
  IsThisRendererActing,
  act,
} from './ReactFiberWorkLoop.old';
import {createUpdate, enqueueUpdate} from './ReactUpdateQueue.old';
import {
  isRendering as ReactCurrentFiberIsRendering,
  current as ReactCurrentFiberCurrent,
  resetCurrentFiber as resetCurrentDebugFiberInDEV,
  setCurrentFiber as setCurrentDebugFiberInDEV,
} from './ReactCurrentFiber';
import {StrictMode} from './ReactTypeOfMode';
import {
  SyncLane,
  InputDiscreteHydrationLane,
  SelectiveHydrationLane,
  NoTimestamp,
  getHighestPriorityPendingLanes,
  higherPriorityLane,
  getCurrentUpdateLanePriority,
  setCurrentUpdateLanePriority,
} from './ReactFiberLane.old';
import {
  scheduleRefresh,
  scheduleRoot,
  setRefreshHandler,
  findHostInstancesForRefresh,
} from './ReactFiberHotReloading.old';
import {markRenderScheduled} from './SchedulingProfiler';

export {registerMutableSourceForHydration} from './ReactMutableSource.new';
export {createPortal} from './ReactPortal';
export {
  createComponentSelector,
  createHasPsuedoClassSelector,
  createRoleSelector,
  createTestNameSelector,
  createTextSelector,
  getFindAllNodesFailureDescription,
  findAllNodes,
  findBoundingRects,
  focusWithin,
  observeVisibleRects,
} from './ReactTestSelectors';

type OpaqueRoot = FiberRoot;

// 0 is PROD, 1 is DEV.
// Might add PROFILE later.
type BundleType = 0 | 1;

type DevToolsConfig = {|
  bundleType: BundleType,
  version: string,
  rendererPackageName: string,
  // Note: this actually *does* depend on Fiber internal fields.
  // Used by "inspect clicked DOM element" in React DevTools.
  findFiberByHostInstance?: (instance: Instance | TextInstance) => Fiber | null,
  rendererConfig?: RendererInspectionConfig,
|};

let didWarnAboutNestedUpdates;
let didWarnAboutFindNodeInStrictMode;

function getContextForSubtree(
  parentComponent: ?React$Component<any, any>,
): Object {
  if (!parentComponent) {
    return emptyContextObject;
  }

  const fiber = getInstance(parentComponent);
  const parentContext = findCurrentUnmaskedContext(fiber);

  if (fiber.tag === ClassComponent) {
    const Component = fiber.type;
    if (isLegacyContextProvider(Component)) {
      return processChildContext(fiber, Component, parentContext);
    }
  }

  return parentContext;
}

function findHostInstance(component: Object): PublicInstance | null {
  const fiber = getInstance(component);
  if (fiber === undefined) {
    if (typeof component.render === 'function') {
      invariant(false, 'Unable to find node on an unmounted component.');
    } else {
      invariant(
        false,
        'Argument appears to not be a ReactComponent. Keys: %s',
        Object.keys(component),
      );
    }
  }
  const hostFiber = findCurrentHostFiber(fiber);
  if (hostFiber === null) {
    return null;
  }
  return hostFiber.stateNode;
}

function findHostInstanceWithWarning(
  component: Object,
  methodName: string,
): PublicInstance | null {
  if (__DEV__) {
    const fiber = getInstance(component);
    if (fiber === undefined) {
      if (typeof component.render === 'function') {
        invariant(false, 'Unable to find node on an unmounted component.');
      } else {
        invariant(
          false,
          'Argument appears to not be a ReactComponent. Keys: %s',
          Object.keys(component),
        );
      }
    }
    const hostFiber = findCurrentHostFiber(fiber);
    if (hostFiber === null) {
      return null;
    }
    if (hostFiber.mode & StrictMode) {
      const componentName = getComponentName(fiber.type) || 'Component';
      if (!didWarnAboutFindNodeInStrictMode[componentName]) {
        didWarnAboutFindNodeInStrictMode[componentName] = true;

        const previousFiber = ReactCurrentFiberCurrent;
        try {
          setCurrentDebugFiberInDEV(hostFiber);
          if (fiber.mode & StrictMode) {
            console.error(
              '%s is deprecated in StrictMode. ' +
                '%s was passed an instance of %s which is inside StrictMode. ' +
                'Instead, add a ref directly to the element you want to reference. ' +
                'Learn more about using refs safely here: ' +
                'https://reactjs.org/link/strict-mode-find-node',
              methodName,
              methodName,
              componentName,
            );
          } else {
            console.error(
              '%s is deprecated in StrictMode. ' +
                '%s was passed an instance of %s which renders StrictMode children. ' +
                'Instead, add a ref directly to the element you want to reference. ' +
                'Learn more about using refs safely here: ' +
                'https://reactjs.org/link/strict-mode-find-node',
              methodName,
              methodName,
              componentName,
            );
          }
        } finally {
          // Ideally this should reset to previous but this shouldn't be called in
          // render and there's another warning for that anyway.
          if (previousFiber) {
            setCurrentDebugFiberInDEV(previousFiber);
          } else {
            resetCurrentDebugFiberInDEV();
          }
        }
      }
    }
    return hostFiber.stateNode;
  }
  return findHostInstance(component);
}

export function createContainer(
  containerInfo: Container,
  tag: RootTag,
  hydrate: boolean,
  hydrationCallbacks: null | SuspenseHydrationCallbacks,
): OpaqueRoot {
  return createFiberRoot(containerInfo, tag, hydrate, hydrationCallbacks);
}

export function updateContainer(
  element: ReactNodeList,
  container: OpaqueRoot,
  parentComponent: ?React$Component<any, any>,
  callback: ?Function,
): Lane {
  const current = container.current;
  const eventTime = requestEventTime();
  const lane = requestUpdateLane(current);

  if (enableSchedulingProfiler) {
    markRenderScheduled(lane);
  }

  const context = getContextForSubtree(parentComponent);
  if (container.context === null) {
    container.context = context;
  } else {
    container.pendingContext = context;
  }

  const update = createUpdate(eventTime, lane);
  // Caution: React DevTools currently depends on this property
  // being called "element".
  update.payload = {element};

  callback = callback === undefined ? null : callback;
  if (callback !== null) {
    update.callback = callback;
  }

  enqueueUpdate(current, update);
  scheduleUpdateOnFiber(current, lane, eventTime);

  return lane;
}

export {
  batchedEventUpdates,
  batchedUpdates,
  unbatchedUpdates,
  deferredUpdates,
  discreteUpdates,
  flushDiscreteUpdates,
  flushControlled,
  flushSync,
  flushPassiveEffects,
  IsThisRendererActing,
  act,
};

export function getPublicRootInstance(
  container: OpaqueRoot,
): React$Component<any, any> | PublicInstance | null {
  const containerFiber = container.current;
  if (!containerFiber.child) {
    return null;
  }
  switch (containerFiber.child.tag) {
    case HostComponent:
      return getPublicInstance(containerFiber.child.stateNode);
    default:
      return containerFiber.child.stateNode;
  }
}

export function attemptSynchronousHydration(fiber: Fiber): void {
  switch (fiber.tag) {
    case HostRoot:
      const root: FiberRoot = fiber.stateNode;
      if (root.hydrate) {
        // Flush the first scheduled "update".
        const lanes = getHighestPriorityPendingLanes(root);
        flushRoot(root, lanes);
      }
      break;
    case SuspenseComponent:
      const eventTime = requestEventTime();
      flushSync(() => scheduleUpdateOnFiber(fiber, SyncLane, eventTime));
      // If we're still blocked after this, we need to increase
      // the priority of any promises resolving within this
      // boundary so that they next attempt also has higher pri.
      const retryLane = InputDiscreteHydrationLane;
      markRetryLaneIfNotHydrated(fiber, retryLane);
      break;
  }
}

function markRetryLaneImpl(fiber: Fiber, retryLane: Lane) {
  const suspenseState: null | SuspenseState = fiber.memoizedState;
  if (suspenseState !== null && suspenseState.dehydrated !== null) {
    suspenseState.retryLane = higherPriorityLane(
      suspenseState.retryLane,
      retryLane,
    );
  }
}

// Increases the priority of thennables when they resolve within this boundary.
function markRetryLaneIfNotHydrated(fiber: Fiber, retryLane: Lane) {
  markRetryLaneImpl(fiber, retryLane);
  const alternate = fiber.alternate;
  if (alternate) {
    markRetryLaneImpl(alternate, retryLane);
  }
}

export function attemptUserBlockingHydration(fiber: Fiber): void {
  if (fiber.tag !== SuspenseComponent) {
    // We ignore HostRoots here because we can't increase
    // their priority and they should not suspend on I/O,
    // since you have to wrap anything that might suspend in
    // Suspense.
    return;
  }
  const eventTime = requestEventTime();
  const lane = InputDiscreteHydrationLane;
  scheduleUpdateOnFiber(fiber, lane, eventTime);
  markRetryLaneIfNotHydrated(fiber, lane);
}

export function attemptContinuousHydration(fiber: Fiber): void {
  if (fiber.tag !== SuspenseComponent) {
    // We ignore HostRoots here because we can't increase
    // their priority and they should not suspend on I/O,
    // since you have to wrap anything that might suspend in
    // Suspense.
    return;
  }
  const eventTime = requestEventTime();
  const lane = SelectiveHydrationLane;
  scheduleUpdateOnFiber(fiber, lane, eventTime);
  markRetryLaneIfNotHydrated(fiber, lane);
}

export function attemptHydrationAtCurrentPriority(fiber: Fiber): void {
  if (fiber.tag !== SuspenseComponent) {
    // We ignore HostRoots here because we can't increase
    // their priority other than synchronously flush it.
    return;
  }
  const eventTime = requestEventTime();
  const lane = requestUpdateLane(fiber);
  scheduleUpdateOnFiber(fiber, lane, eventTime);
  markRetryLaneIfNotHydrated(fiber, lane);
}

export function runWithPriority<T>(priority: LanePriority, fn: () => T) {
  const previousPriority = getCurrentUpdateLanePriority();
  try {
    setCurrentUpdateLanePriority(priority);
    return fn();
  } finally {
    setCurrentUpdateLanePriority(previousPriority);
  }
}

export {getCurrentUpdateLanePriority};

export {findHostInstance};

export {findHostInstanceWithWarning};

export function findHostInstanceWithNoPortals(
  fiber: Fiber,
): PublicInstance | null {
  const hostFiber = findCurrentHostFiberWithNoPortals(fiber);
  if (hostFiber === null) {
    return null;
  }
  if (hostFiber.tag === FundamentalComponent) {
    return hostFiber.stateNode.instance;
  }
  return hostFiber.stateNode;
}

let shouldSuspendImpl = fiber => false;

export function shouldSuspend(fiber: Fiber): boolean {
  return shouldSuspendImpl(fiber);
}

let overrideHookState = null;
let overrideHookStateDeletePath = null;
let overrideHookStateRenamePath = null;
let overrideProps = null;
let overridePropsDeletePath = null;
let overridePropsRenamePath = null;
let scheduleUpdate = null;
let setSuspenseHandler = null;

function findHostInstanceByFiber(fiber: Fiber): Instance | TextInstance | null {
  const hostFiber = findCurrentHostFiber(fiber);
  if (hostFiber === null) {
    return null;
  }
  return hostFiber.stateNode;
}

function emptyFindFiberByHostInstance(
  instance: Instance | TextInstance,
): Fiber | null {
  return null;
}

function getCurrentFiberForDevTools() {
  return ReactCurrentFiberCurrent;
}

export function injectIntoDevTools(devToolsConfig: DevToolsConfig): boolean {
  const {findFiberByHostInstance} = devToolsConfig;
  const {ReactCurrentDispatcher} = ReactSharedInternals;

  return injectInternals({
    bundleType: devToolsConfig.bundleType,
    version: devToolsConfig.version,
    rendererPackageName: devToolsConfig.rendererPackageName,
    rendererConfig: devToolsConfig.rendererConfig,
    overrideHookState,
    overrideHookStateDeletePath,
    overrideHookStateRenamePath,
    overrideProps,
    overridePropsDeletePath,
    overridePropsRenamePath,
    setSuspenseHandler,
    scheduleUpdate,
    currentDispatcherRef: ReactCurrentDispatcher,
    findHostInstanceByFiber,
    findFiberByHostInstance:
      findFiberByHostInstance || emptyFindFiberByHostInstance,
    // React Refresh
    findHostInstancesForRefresh: __DEV__ ? findHostInstancesForRefresh : null,
    scheduleRefresh: __DEV__ ? scheduleRefresh : null,
    scheduleRoot: __DEV__ ? scheduleRoot : null,
    setRefreshHandler: __DEV__ ? setRefreshHandler : null,
    // Enables DevTools to append owner stacks to error messages in DEV mode.
    getCurrentFiber: __DEV__ ? getCurrentFiberForDevTools : null,
  });
}
