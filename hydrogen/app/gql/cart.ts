import { gql } from '@shopify/hydrogen';

export const CART_QUERY = gql`
  query Cart($cartId: ID!) {
    cart(id: $cartId) {
      id
      checkoutUrl
      cost {
        subtotalAmount { amount currencyCode }
        totalAmount { amount currencyCode }
      }
      lines(first: 10) {
        nodes {
          id
          quantity
          merchandise {
            ... on ProductVariant {
              id
              title
              product { title handle }
              price {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;
