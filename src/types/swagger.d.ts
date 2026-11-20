declare module "swagger-ui-dist/swagger-ui-bundle.js" {
  export default function createSwaggerUI(options: {
    domNode: HTMLElement;
    url: string;
    validatorUrl: null;
    deepLinking: boolean;
    persistAuthorization: boolean;
  }): unknown;
}
