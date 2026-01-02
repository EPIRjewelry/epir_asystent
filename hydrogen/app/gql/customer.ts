import { gql } from '@shopify/hydrogen';

export const CUSTOMER_QUERY = gql`
  query Customer {
    customer {
      id
      email
      firstName
      lastName
    }
  }
`;
