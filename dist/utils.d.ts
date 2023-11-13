export interface ObserveSelectorOptions {
    timeout?: number;
    once?: boolean;
    onTimeout?: number;
    document?: Document;
}
export declare const observeSelector: <ElementType extends HTMLElement>(selector: string, callback: (el: ElementType) => void, options?: ObserveSelectorOptions) => () => void;
export declare const waitForElement: <ElementType extends HTMLElement>(selector: string) => Promise<ElementType>;
export declare const waitUntil: (test: () => boolean) => Promise<void>;
