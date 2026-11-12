import { Routes } from '@angular/router';
import { InboxComponent } from './inbox.component';
import { MailDetailComponent } from './mail-detail.component';
import { NotFoundComponent } from './not-found.component';

export const routes: Routes = [
  { path: '', redirectTo: 'inbox', pathMatch: 'full' },
  { path: 'inbox', component: InboxComponent },
  { path: 'mail/:id', component: MailDetailComponent },
  { path: '**', component: NotFoundComponent },
];
