import { createCookieSessionStorage } from '@remix-run/server-runtime';
import { CART_QUERY } from '../gql/cart';
import { getStorefront } from './storefront.server';

const cartSession = createCookieSessionStorage({
  cookie: {
    name: '__epir_cart',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: true,
  },
});

export async function getCart(request: Request, env: Env) {
  const session = await cartSession.getSession(request.headers.get('Cookie'));
  const cartId = session.get('cartId') as string | undefined;
  if (!cartId) return { cart: null, cartId: null, headers: null };

  const storefront = getStorefront(env, request);
  const { data } = await storefront.query(CART_QUERY, { variables: { cartId } });
  return { cart: data?.cart ?? null, cartId, headers: null };
}

export async function setCartId(cartId: string | null, headers: Headers) {
  const session = await cartSession.getSession();
  if (cartId) session.set('cartId', cartId);
  const cookie = await cartSession.commitSession(session);
  headers.append('Set-Cookie', cookie);
}
