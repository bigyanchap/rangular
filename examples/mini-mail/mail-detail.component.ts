import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MailService } from './mail.service';

@Component({
  selector: 'app-mail-detail',
  templateUrl: './mail-detail.component.html',
})
export class MailDetailComponent {
  mail: any = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private mailService: MailService,
  ) {}

  ngOnInit() {
    this.mail = this.mailService.getById(this.route.snapshot.params.id);
  }

  backToInbox() {
    this.router.navigate(['/inbox']);
  }
}
