export interface ObserveSelectorOptions {
  timeout?: number;
  once?: boolean;
  onTimeout?: number;
  document?: Document;
}

export const observeSelector = <ElementType extends HTMLElement>(
  selector: string,
  callback: (el: ElementType) => void,
  options: ObserveSelectorOptions = {}
): (() => void) => {
  const document = options.document || window.document;
  const processed = new Map<HTMLElement, boolean>();

  if (options.timeout || options.onTimeout) {
    throw `observeSelector options \`timeout\` and \`onTimeout\` are not yet implemented.`;
  }

  let obs: MutationObserver;
  let isDone = false;
  const done = (): void => {
    if (obs) obs.disconnect();
    isDone = true;
  };

  const processElement = (el: HTMLElement): boolean => {
    if (processed && !processed.has(el)) {
      processed.set(el, true);
      callback(el as ElementType);
      if (options.once) {
        done();
        return true;
      }
    }
    return false;
  };

  const lookForSelector = (elParent: HTMLElement): boolean => {
    if (elParent.matches && elParent.matches(selector)) {
      if (processElement(elParent)) return true;
    }
    if (elParent.querySelectorAll) {
      const elements = elParent.querySelectorAll(selector);
      if (elements.length) {
        for (const el of elements) {
          if (processElement(el as HTMLElement)) return true;
        }
      }
    }
    return false;
  };
  lookForSelector(document.documentElement);

  // We might finish before the mutation observer is necessary:
  if (!isDone) {
    obs = new MutationObserver((mutationsList) => {
      mutationsList.forEach((record) => {
        if (record && record.addedNodes && record.addedNodes.length) {
          for (const addedNode of record.addedNodes) {
            // Need to check from the parent element since sibling selectors can be thrown off if elements show up in non-sequential order
            const el = addedNode.parentElement;
            // if (!el) console.warn('observeSelector element has no parent', record.addedNodes[i], record);
            // Note: This appears to also run when elements are removed from the DOM. If the element doesn't have a parent then we don't need to check it.
            if (el && lookForSelector(el)) return true;
          }
        }
      });
    });
    obs.observe(document, {
      attributes: false,
      childList: true,
      subtree: true,
    });
  }

  return done;
};

export const waitForElement = <ElementType extends HTMLElement>(
  selector: string
) =>
  new Promise<ElementType>((resolve) => {
    observeSelector<ElementType>(selector, resolve, { once: true });
  });

export const waitUntil = (test: () => boolean) =>
  new Promise<void>((resolve) => {
    (function poll() {
      if (!test()) return window.requestAnimationFrame(poll);
      return resolve();
    })();
  });
