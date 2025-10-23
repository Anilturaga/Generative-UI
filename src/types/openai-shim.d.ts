declare module 'openai' {
  export default class OpenAI {
    constructor(config?: any);
    chat: {
      completions: {
        create(params: any): AsyncIterable<any> & { finalChatCompletion?: () => Promise<any> };
      };
    };
  }
}


