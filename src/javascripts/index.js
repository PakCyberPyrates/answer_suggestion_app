import ZAFClient from 'zendesk_app_framework_sdk';
import I18n from 'i18n';
import AnswerSuggestionsApp from './answer_suggestions_app';

var client = ZAFClient.init();

client.on('app.registered', function(appData) {
  client.get('currentUser.locale').then(userData => {
    I18n.loadTranslations(userData['currentUser.locale']);
    new AnswerSuggestionsApp(client, appData);
  });
});
