import {UserWithAuthToken, GoogleProfile} from './userSchema';
import {GraphQLEmailType, GraphQLPasswordType} from '../types';
import {getUserByEmail, signJwt, getAltLoginMessage, makeSecretToken} from './helpers';
import {errorObj} from '../utils';
import {GraphQLNonNull, GraphQLBoolean} from 'graphql';
import validateSecretToken from '../../../../universal/utils/validateSecretToken';
import {isLoggedIn} from '../authorization';
import promisify from 'es6-promisify';
import bcrypt from 'bcrypt';
import uuid from 'node-uuid';
import knex from '../../../database/knexDriver';
import moment from 'moment'
const compare = promisify(bcrypt.compare);
const hash = promisify(bcrypt.hash);

export default {
  createUser: {
    type: UserWithAuthToken,
    args: {
      email: {type: new GraphQLNonNull(GraphQLEmailType)},
      password: {type: new GraphQLNonNull(GraphQLPasswordType)}
    },
    async resolve(source, {email, password}) {
      const user = await getUserByEmail(email);
      if (user) {
        const hashedPassword = user.password
        if (!hashedPassword) {
          throw errorObj({_error: 'no password'});
        }
        const isCorrectPass = await compare(password, hashedPassword);
        if (isCorrectPass) {
          const authToken = signJwt({id: user.id});
          return {authToken, user};
        }
        throw errorObj({_error: 'Cannot create account', email: 'Email already exists'});
      } else {
        // production should use 12+, but it's slow for dev
        const newHashedPassword = await hash(password, 10);
        const id = uuid.v4(); //When I change all column without timezone then I execute insertArticle shows the error
        // must verify email within 1 day
        const verifiedEmailToken = makeSecretToken(id, 60 * 24);
        const userDoc = {
          id,
          email,
          // created_at: moment(new Date()).unix(),
          isVerified: false,
          password: newHashedPassword,
          verifiedEmailToken
        };
        console.log(knex('users').insert(userDoc).toString())
        const newUser = await knex('users').insert(userDoc);
        if (!newUser) {
          throw errorObj({_error: 'Could not create account, please try again'});
        }
        // TODO send email with verifiedEmailToken via mailgun or whatever
        console.log('Verify url:', `http://localhost:3000/verify-email/${verifiedEmailToken}`);
        const authToken = signJwt({id});
        return {user: userDoc, authToken};
      }
    }
  },
  emailPasswordReset: {
    type: GraphQLBoolean,
    args: {
      email: {type: new GraphQLNonNull(GraphQLEmailType)}
    },
    async resolve(source, {email}) {
      const user = await getUserByEmail(email);
      if (!user) {
        throw errorObj({_error: 'User not found'});
      }
      const resetToken = makeSecretToken(user.id, 60 * 24);
      const result = await knex('users').returning('*').select({id: user.id}).update({resetToken});
      if (!result) {
        throw errorObj({_error: 'Could not find or update user'});
      }
      console.log('Reset url:', `http://localhost:3000/login/reset-password/${resetToken}`);
      return true;
    }
  },
  resetPassword: {
    type: UserWithAuthToken,
    args: {
      password: {type: new GraphQLNonNull(GraphQLPasswordType)}
    },
    async resolve(source, {password}, {resetToken}) {
      const resetTokenObject = validateSecretToken(resetToken);
      if (resetTokenObject._error) {
        throw errorObj(resetTokenObject);
      }
      const user = await knex('users').select('resetToken').where({resetToken});
      if (!user) {
        throw errorObj({_error: 'User not found'});
      }
      const userResetToken = user.resetToken;
      if (!userResetToken || userResetToken !== resetToken) {
        throw errorObj({_error: 'Unauthorized'});
      }
      const newHashedPassword = await hash(password, 10);
      const updates = {
        password: newHashedPassword,
        resetToken: null
      };
      const newUser = await knex('users').select({id: user.id}).returning('*').update(updates);
      if (!newUser) {
        throw errorObj({_error: 'Could not find or update user'});
      }
      const newAuthToken = signJwt(newUser);
      return {newAuthToken, user: newUser};
    }
  },
  resendVerificationEmail: {
    type: GraphQLBoolean,
    async resolve(source, args, {authToken}) {
      // isLoggedIn(authToken);
      // const {id} = authToken;
      // const user = await r.table('users').get(id);
      // if (!user) {
      //   throw errorObj({_error: 'User not found'});
      // }
      // if (user.strategies && user.strategies.local && user.strategies.local.isVerified) {
      //   throw errorObj({_error: 'Email already verified'});
      // }
      // const verifiedEmailToken = makeSecretToken(id, 60 * 24);
      // const result = await r.table('users').get(id).update({strategies: {local: {verifiedEmailToken}}});
      // if (!result.replaced) {
      //   throw errorObj({_error: 'Could not find or update user'});
      // }
      // // TODO send email with new verifiedEmailToken via mailgun or whatever
      // console.log('Verified url:', `http://localhost:3000/login/verify-email/${verifiedEmailToken}`);
      return true;
    }
  },
  verifyEmail: {
    type: UserWithAuthToken,
    async resolve(source, args, {verifiedEmailToken}) {
      const verifiedEmailTokenObj = validateSecretToken(verifiedEmailToken);
      if (verifiedEmailTokenObj._error) {
        throw errorObj(verifiedEmailTokenObj);
      }
      const user = await knex('users').select({verifiedEmailToken: verifiedEmailTokenObj.id});
      if (!user) {
        throw errorObj({_error: 'User not found'});
      }
      if (user.isVerified) {
        throw errorObj({_error: 'Email already verified'});
      }
      if (user.verifiedEmailToken) {
        throw errorObj({_error: 'Unauthorized'});
      }
      const updates = {
        isVerified: true,
        verifiedEmailToken: null
      };
      const result = await knex('users')
      .select({verifiedEmailToken: verifiedEmailTokenObj.id})
      .returning('*')
      .update(updates);
      console.log('verify email', result)
      if (!result) {
        throw errorObj({_error: 'Could not find or update user'});
      }
      return {
        user: result,
        authToken: signJwt(verifiedEmailTokenObj)
      };
    }
  },
  loginWithGoogle: {
    type: UserWithAuthToken,
    args: {
      profile: {type: new GraphQLNonNull(GoogleProfile)}
    },
    async resolve(source, {profile}) {
    //   const user = await getUserByEmail(profile.email);
    //   if (!user) {
    //     // create new user
    //     const userDoc = {
    //       email: profile.email,
    //       createdAt: new Date(),
    //       strategies: {
    //         google: {
    //           id: profile.id,
    //           email: profile.email,
    //           isVerified: profile.verified_email, // we'll assume this is always true
    //           name: profile.name,
    //           firstName: profile.given_name,
    //           lastName: profile.family_name,
    //           // link: profile.link, //who cares, it's google+
    //           picture: profile.picture,
    //           gender: profile.gender,
    //           locale: profile.locale
    //         }
    //       }
    //     };
    //     const result = await r.table('users').insert(userDoc, {returnChanges: true});
    //     if (!result.inserted) {
    //       throw errorObj({_error: 'Could not find or update user'});
    //     }
    //     const authToken = signJwt({id: user.id});
    //     return {authToken, user: result.changes[0].new_val};
    //   }
    //   // if the user already exists && they have a google strategy
    //   if (user.strategies && user.strategies.google) {
    //     if (user.strategies.google.id !== profile.id) {
    //       throw errorObj({_error: 'Unauthorized'});
    //     }
    //     const authToken = signJwt({id: user.id});
    //     return {authToken, user};
    //   }
    //   // if the user already exists && they don't have a google strategy
    //   throw errorObj(getAltLoginMessage(user.strategies));
    }
  }
};
